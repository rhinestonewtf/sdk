import { type Address, type Chain, erc20Abi } from 'viem'
import {
  buildOneTimeUseBurnOp,
  type OneTimeUseBurnOp,
  type OneTimeUseSettlementRoute,
} from '../../modules/validators/smart-sessions/one-time-use'
import { toSession as resolveSession } from '../../modules/validators/smart-sessions/resolve'
import type {
  CrossChainPermissionInput,
  CrossChainSettlementLayer,
  Permission,
  ResolvedPolicy,
  Session,
  SessionDefinition,
  SessionPolicyAddresses,
} from '../../modules/validators/smart-sessions/types'
import type { OwnerSet } from '../../modules/validators/types'

// RHI-6242 (experimental): declare a spend in business terms — tokens, amounts,
// recipients, target chains — and let the SDK formulate the session-policy
// combination for the appropriate settlement route, instead of hand-wiring
// arbiter policies. Covers the two scoped use cases:
//   - same-chain send  → IntentExecutor (executor) route: universal-action
//     scoping (recipient allowlist + amount cap) + optional one-time-use.
//   - cross-chain send → Permit2 route: a claim policy bound to the settlement
//     layer's arbiter (recipient/token/amount scoping) + optional one-time-use.
// `singleUse` selects the new Quorum-signer one-time-use method; omitting it is
// the "old way" (explicit policy config, no burn op).

// The settlement layers a spend may target. The three arbiter-based layers are
// enforceable today via the Permit2 claim policy; the IntentExecutor-backed
// layers need the settlement-layer adapter policy (smart-sessions-v2 #46) to
// scope per-session, so they are declared here but refused until that lands.
export type SpendSettlementLayer =
  | 'SAME_CHAIN'
  | 'ECO'
  | 'ACROSS'
  | 'RHINO'
  | 'RELAY'
  | 'CCTP'
  | 'NEAR'
  | 'OFT'

export interface LayerCapability {
  // How the layer is scoped: the Permit2 claim policy (arbiter route) or the
  // per-layer IntentExecutor adapter ACL (adapter route).
  readonly surface: 'claim-policy' | 'intent-executor-adapter'
  // Which spend fields the layer can actually enforce. A `false` here means a
  // restriction on that field would be fiction — the builder refuses it.
  readonly enforceable: {
    readonly recipient: boolean
    readonly amount: boolean
    readonly token: boolean
    readonly chain: boolean
  }
  // False until the IntentExecutor settlement-layer policy family is deployed and
  // the SDK exposes an ERC-1271-policy input. Arbiter layers are true today.
  readonly availableToday: boolean
}

const ARBITER_ENFORCEABLE = {
  recipient: true,
  amount: true,
  token: true,
  chain: true,
} as const

// Per-layer scoping capability. Enforceable flags for the adapter layers mirror
// what each layer's on-chain calldata exposes (e.g. Rhino carries no on-chain
// recipient; Relay's calldata is opaque) — see RHI-6242.
export const LAYER_CAPABILITIES: Readonly<
  Record<SpendSettlementLayer, LayerCapability>
> = Object.freeze({
  SAME_CHAIN: {
    surface: 'claim-policy',
    enforceable: ARBITER_ENFORCEABLE,
    availableToday: true,
  },
  ECO: {
    surface: 'claim-policy',
    enforceable: ARBITER_ENFORCEABLE,
    availableToday: true,
  },
  ACROSS: {
    surface: 'claim-policy',
    enforceable: ARBITER_ENFORCEABLE,
    availableToday: true,
  },
  CCTP: {
    surface: 'intent-executor-adapter',
    enforceable: { recipient: true, amount: true, token: true, chain: true },
    availableToday: false,
  },
  RHINO: {
    surface: 'intent-executor-adapter',
    enforceable: { recipient: false, amount: true, token: true, chain: false },
    availableToday: false,
  },
  OFT: {
    surface: 'intent-executor-adapter',
    enforceable: { recipient: true, amount: true, token: true, chain: true },
    availableToday: false,
  },
  RELAY: {
    surface: 'intent-executor-adapter',
    enforceable: {
      recipient: false,
      amount: false,
      token: false,
      chain: false,
    },
    availableToday: false,
  },
  NEAR: {
    surface: 'intent-executor-adapter',
    enforceable: { recipient: false, amount: true, token: true, chain: false },
    availableToday: false,
  },
})

const ARBITER_LAYERS: readonly SpendSettlementLayer[] = [
  'SAME_CHAIN',
  'ECO',
  'ACROSS',
]

// Refuses any requested settlement layer the builder cannot honestly enforce,
// rather than emitting a restricted-looking-but-unrestricted session.
function assertLayersEnforceable(input: DefineSpendSessionInput): void {
  const layers = input.spend.target?.settlementLayers
  if (!layers || layers.length === 0) return
  const wantsRecipient = (input.spend.recipients?.length ?? 0) > 0
  const wantsAmount = input.spend.tokens.some((t) => t.maxAmount !== undefined)
  const wantsChain = (input.spend.target?.chains.length ?? 0) > 0
  for (const layer of layers) {
    const cap = LAYER_CAPABILITIES[layer]
    if (!cap.availableToday) {
      throw new Error(
        `Settlement layer "${layer}" is not yet supported by defineSpendSession ` +
          `(needs the IntentExecutor settlement-layer policy; see RHI-6242). ` +
          `Supported today: ${ARBITER_LAYERS.join(', ')}.`,
      )
    }
    // Field-enforceability refusals. Every adapter layer is availableToday:false
    // today, so these are reached only once a layer is flipped on — they keep the
    // builder from emitting a field-restricted-looking but unrestricted session.
    if (wantsRecipient && !cap.enforceable.recipient) {
      throw new Error(
        `Settlement layer "${layer}" cannot enforce a recipient restriction; ` +
          `remove recipients or drop "${layer}".`,
      )
    }
    if (wantsAmount && !cap.enforceable.amount) {
      throw new Error(
        `Settlement layer "${layer}" cannot enforce an amount cap; ` +
          `remove maxAmount or drop "${layer}".`,
      )
    }
    if (wantsChain && !cap.enforceable.chain) {
      throw new Error(
        `Settlement layer "${layer}" cannot enforce a target-chain restriction; ` +
          `drop "${layer}".`,
      )
    }
  }
}

export interface SpendToken {
  readonly token: Address
  // Upper bound on the amount this session may move for this token. Omit for no cap.
  readonly maxAmount?: bigint
}

export interface SpendTarget {
  // Destination chains. Any chain other than the session chain makes this a
  // cross-chain spend (Permit2 route); omit `target` entirely for same-chain.
  readonly chains: Chain[]
  // Which settlement layers may fill the cross-chain send. Omit to allow all
  // supported layers. Layers not enforceable today are refused (see
  // LAYER_CAPABILITIES).
  readonly settlementLayers?: SpendSettlementLayer[]
  // Destination-chain token address for each target chain. Required for every
  // target chain — token addresses differ per chain, so there is no safe default.
  readonly tokens: { readonly chain: Chain; readonly token: Address }[]
}

export interface SpendIntent {
  readonly tokens: [SpendToken, ...SpendToken[]]
  // Addresses the funds may be sent to. Same-chain: omit to allow ANY recipient
  // (pair with maxAmount or singleUse to bound the spend). Cross-chain: omit to
  // bind the recipient to the account. Must be non-empty when provided.
  readonly recipients?: Address[]
  // Omit for a same-chain spend.
  readonly target?: SpendTarget
  readonly validUntil?: Date
  readonly validAfter?: Date
}

export interface DefineSpendSessionInput {
  readonly chain: Chain
  readonly owners: OwnerSet
  readonly spend: SpendIntent
  // Pins a one-time-use id: the session settles at most once per chain, and
  // `buildBurnOp()` yields the burn op to inject into the intent's source calls.
  // Requires `policyAddresses.oneTimeUseId`.
  readonly singleUse?: { readonly id: bigint }
  // Pre-encoded ERC-1271 policy entries to install on the session (e.g. an
  // IntentExecutor settlement-layer policy — see intentExecutorPolicyEntry). This
  // is the escape hatch for scoping the IntentExecutor-backed layers until the
  // builder can auto-derive their per-layer configs. Mutually exclusive with the
  // Permit2 claim policy (arbiter route), so it cannot be combined with a
  // cross-chain arbiter `target`.
  readonly erc1271Policies?: ResolvedPolicy[]
  readonly policyAddresses?: SessionPolicyAddresses
  readonly useDevContracts?: boolean
}

export interface SpendSession {
  readonly session: Session
  readonly route: OneTimeUseSettlementRoute
  // The one-time-use burn op to place in the intent's source calls. Throws when
  // the session was not created with `singleUse`.
  readonly buildBurnOp: () => OneTimeUseBurnOp
}

function isCrossChain(input: DefineSpendSessionInput): boolean {
  return (
    input.spend.target?.chains.some((c) => c.id !== input.chain.id) ?? false
  )
}

// Maps the spend intent onto the existing cross-chain permit expansion, which
// already selects the settlement-layer arbiter and derives the claim policy plus
// spending-limit/time-frame guardrails.
function crossChainPermit(
  input: DefineSpendSessionInput,
): CrossChainPermissionInput {
  const { chain, spend } = input
  const target = spend.target as SpendTarget
  const destTokenFor = (c: Chain): Address => {
    const entry = target.tokens?.find((t) => t.chain.id === c.id)
    if (!entry) {
      throw new Error(
        `cross-chain spend needs a destination token for chain ${c.id} ` +
          `(target.tokens) — token addresses differ per chain`,
      )
    }
    return entry.token
  }
  const recipients: (Address | undefined)[] = spend.recipients ?? [undefined]
  return {
    from: spend.tokens.map((t) => ({
      chain,
      token: t.token,
      maxAmount: t.maxAmount,
    })),
    to: target.chains.flatMap((c) =>
      recipients.map((recipient) => ({
        chain: c,
        token: destTokenFor(c),
        ...(recipient ? { recipient } : {}),
      })),
    ),
    // Only arbiter layers reach here — assertLayersEnforceable refuses the rest.
    settlementLayers: target.settlementLayers as
      | CrossChainSettlementLayer[]
      | undefined,
    validUntil: spend.validUntil,
    validAfter: spend.validAfter,
    allowRecipientNotAccount: spend.recipients !== undefined,
  }
}

// Same-chain scoping: one universal-action permission per token restricting the
// ERC-20 `transfer` to the allowed recipients and amount. This is the "standard
// action policy" enforced on the executor route via checkAction.
function sameChainPermissions(input: DefineSpendSessionInput): Permission[] {
  const { spend } = input
  const recipients = spend.recipients
  const recipientConstraint =
    recipients === undefined
      ? undefined
      : recipients.length === 1
        ? { condition: 'equal' as const, value: recipients[0] }
        : { anyOf: recipients as [Address, ...Address[]] }
  return spend.tokens.map((t) => ({
    abi: erc20Abi,
    address: t.token,
    functions: {
      transfer: {
        ...(recipientConstraint
          ? { params: { recipient: recipientConstraint } }
          : {}),
        ...(t.maxAmount !== undefined
          ? { spendingLimit: { token: t.token, amount: t.maxAmount } }
          : {}),
        ...(spend.validUntil ? { validUntil: spend.validUntil } : {}),
        ...(spend.validAfter ? { validAfter: spend.validAfter } : {}),
      },
    },
  })) as Permission[]
}

export function experimental_defineSpendSession(
  input: DefineSpendSessionInput,
): SpendSession {
  if (input.spend.tokens.length === 0) {
    throw new Error('spend session requires at least one token')
  }
  if (input.singleUse && !input.policyAddresses?.oneTimeUseId) {
    throw new Error(
      'spend session with singleUse requires policyAddresses.oneTimeUseId',
    )
  }
  if (input.spend.recipients?.length === 0) {
    throw new Error(
      'spend.recipients must be non-empty; omit it to allow any recipient ' +
        '(same-chain) or bind to the account (cross-chain)',
    )
  }
  assertLayersEnforceable(input)
  const crossChain = isCrossChain(input)
  const route: OneTimeUseSettlementRoute = crossChain ? 'permit2' : 'executor'

  // A same-chain spend with no restriction at all resolves to a sudo transfer
  // action (any recipient, any amount) — never emit that silently. Require at
  // least one bound: a recipient allowlist, an amount cap, a time window, or the
  // single-use burn.
  if (!crossChain) {
    const bounded =
      (input.spend.recipients?.length ?? 0) > 0 ||
      input.spend.tokens.some((t) => t.maxAmount !== undefined) ||
      input.spend.validUntil !== undefined ||
      input.spend.validAfter !== undefined ||
      input.singleUse !== undefined
    if (!bounded) {
      throw new Error(
        'unrestricted same-chain spend: provide recipients, a token maxAmount, ' +
          'validUntil/validAfter, or singleUse',
      )
    }
  }

  // A settlement-layer 1271 policy and the Permit2 claim policy both live on the
  // 1271 AND-list and gate different routes, so they are mutually exclusive.
  const hasErc1271 = (input.erc1271Policies?.length ?? 0) > 0
  if (hasErc1271 && crossChain) {
    throw new Error(
      'erc1271Policies (settlement-layer policy) is mutually exclusive with a ' +
        'cross-chain arbiter target (Permit2 claim policy); use one route.',
    )
  }

  const definition: SessionDefinition = {
    chain: input.chain,
    owners: input.owners,
    policyAddresses: input.policyAddresses,
    ...(crossChain
      ? { crossChainPermits: [crossChainPermit(input)] }
      : { permissions: sameChainPermissions(input) }),
    ...(input.singleUse ? { oneTimeUse: { id: input.singleUse.id } } : {}),
    ...(hasErc1271 ? { erc1271Policies: input.erc1271Policies } : {}),
  }

  const session = resolveSession(definition, {
    environment: input.useDevContracts ? 'development' : 'production',
  }) as Session

  return {
    session,
    route,
    buildBurnOp: () => {
      const policy = input.policyAddresses?.oneTimeUseId
      if (!input.singleUse || !policy) {
        throw new Error(
          'buildBurnOp is only available for a singleUse spend session',
        )
      }
      return buildOneTimeUseBurnOp({ policy, id: input.singleUse.id, route })
    },
  }
}
