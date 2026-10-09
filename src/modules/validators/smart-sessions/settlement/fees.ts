import {
  type Address,
  type Hex,
  isAddressEqual,
  toFunctionSelector,
} from 'viem'
import { resolvePermissions } from '../../permissions'
import { refusal } from '../refusals'
import {
  allOf,
  anyOf,
  cumulativeCap,
  cumulativeOnly,
  pin,
  swapAction,
} from '../swap/rules'
import type {
  ArgPolicyExpression,
  Permission,
  ScopedAction,
  SessionPolicy,
  UniversalActionPolicyParamRule,
} from '../types'
import { withRule } from './same-chain'
import type { SettlementAddresses, SettlementCatalog } from './types'

/**
 * `allowFees` (RHI-7884): the app-fee transfer and the unsponsored-gas paymaster
 * calls the orchestrator adds before the layer calls. Each call has its own
 * USD cap ({@link settlementFeeCap}): per `from` token for the transfer and
 * approve, one shared across tokens for the callback.
 */

/**
 * The per-call cap where {@link settlementFeeCap} has no chain entry: 5 USD at
 * 6 decimals. Cumulative: the burning transaction admits every later op.
 */
export const DEFAULT_SETTLEMENT_FEE_CAP = 5_000_000n

/** Chains whose cap differs from the default, in USD at 6 decimals. */
const SETTLEMENT_FEE_CAP_BY_CHAIN: Readonly<Record<number, bigint>> = {
  // Ethereum mainnet: a session enable needs a gas refund above 5 USD.
  1: 30_000_000n,
}

/** The per-call fee cap on `chainId`, in USD at 6 decimals. */
export function settlementFeeCap(chainId: number): bigint {
  return SETTLEMENT_FEE_CAP_BY_CHAIN[chainId] ?? DEFAULT_SETTLEMENT_FEE_CAP
}

const TRANSFER_SELECTOR = toFunctionSelector('transfer(address,uint256)')
const APPROVE_SELECTOR = toFunctionSelector('approve(address,uint256)')
export const CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR = toFunctionSelector(
  'callbackAllowMaxAmount(address,uint256)',
)

type Fees = NonNullable<SettlementAddresses['fees']>

type ParamsPolicy = Extract<
  SessionPolicy,
  { type: 'universal-action' | 'arg-policy' }
>

const isParamsPolicy = (policy: SessionPolicy): policy is ParamsPolicy =>
  policy.type === 'universal-action' || policy.type === 'arg-policy'

/** The chain's fee addresses, once every `from` token is one the layers serve. */
export function servedFees(
  settlement: SettlementCatalog | undefined,
  chainId: number,
  sourceTokens: readonly Address[],
): Fees {
  if (settlement === undefined) {
    throw refusal(
      'ALLOW_FEES_CATALOG_MISSING',
      "crossChainPermits: allowFees needs the orchestrator's settlement addresses; create the session with sdk.createSession",
    )
  }
  const chain = settlement[chainId]
  if (chain?.fees === undefined) {
    throw refusal(
      'FEES_NOT_SERVED',
      `crossChainPermits: the orchestrator serves no fee addresses on chain ${chainId}, so allowFees cannot be scoped there`,
      { chainId },
    )
  }
  // The cap is a USD amount, so it only bounds the stablecoins the layers serve
  // (all 6-decimal today); any other token would make it meaningless.
  const stables = [
    chain.cctp?.usdc,
    chain.oft?.token,
    ...(chain.eco?.stablecoins ?? []),
    chain.lz?.stargateUsdc?.token,
    chain.lz?.cctp?.token,
  ].filter((token): token is Address => token !== undefined)
  for (const token of sourceTokens) {
    if (!stables.some((stable) => isAddressEqual(stable, token))) {
      throw refusal(
        'ALLOW_FEES_NON_STABLECOIN',
        `crossChainPermits: allowFees caps fees in USD, so every \`from\` token must be a served USD stablecoin; ${token} on chain ${chainId} is not`,
        { chainId },
      )
    }
    // The cap is in 6-decimal units: fewer decimals would scale it up by orders
    // of magnitude. A chain serving no usdStablecoins entry for it is not checked.
    const listed = (chain.usdStablecoins ?? []).find(
      (t) => isAddressEqual(t.address, token) && t.decimals !== 6,
    )
    if (listed !== undefined) {
      throw refusal(
        'ALLOW_FEES_NON_STABLECOIN',
        `crossChainPermits: allowFees caps fees in 6-decimal USD, so a \`from\` token must be 6-decimal; ${token} on chain ${chainId} is served with ${listed.decimals} decimals`,
        { chainId },
      )
    }
  }
  return chain.fees
}

/**
 * Turn the swap scope's approve permissions into raw actions, so the paymaster
 * approve can join them. The spending limit becomes a cumulative cap on the
 * swap's params policy: a shared limit would count the fee approves against it.
 */
export function swapApprovesAsActions(
  permissions: readonly Permission[],
  cap: bigint | undefined,
): ScopedAction[] {
  if (permissions.length === 0) return []
  // scopeSameChain refuses an uncapped swap first; this keeps the cap from being dropped.
  if (cap === undefined) {
    throw refusal(
      'SAME_CHAIN_IE_SWAP_NEEDS_MAX_AMOUNT',
      'crossChainPermits: a SAME_CHAIN_IE swap with allowFees needs maxAmount',
    )
  }
  return resolvePermissions([...permissions]).map((action) => {
    if (!('target' in action) || action.selector !== APPROVE_SELECTOR) {
      throw new Error(
        'crossChainPermits (internal): allowFees expected only approve permissions from the swap scope',
      )
    }
    const policies = action.policies ?? []
    // Dropping the spending limit is only safe with a params policy to carry the cap.
    if (!policies.some(isParamsPolicy)) {
      throw new Error(
        'crossChainPermits (internal): a swap approve has no params policy to carry its cap',
      )
    }
    return {
      ...action,
      policies: policies
        .filter((policy) => policy.type !== 'spending-limits')
        .map((policy) =>
          isParamsPolicy(policy)
            ? withRule(policy, cumulativeCap(32n, cap))
            : policy,
        ),
    }
  })
}

/**
 * Allow `branch` as a shape of the (target, selector) call: a new action when the
 * layer makes no such call, else ORed into the layer's one params policy, since
 * the chain keeps a single config per policy and action.
 */
function addFeeBranch(
  actions: ScopedAction[],
  target: Address,
  selector: Hex,
  branch: UniversalActionPolicyParamRule[] | ArgPolicyExpression,
): void {
  const index = actions.findIndex(
    (a) => isAddressEqual(a.target, target) && a.selector === selector,
  )
  if (index === -1) {
    // A rule list goes on UniversalActionPolicy, whose enable writes fewer slots.
    const policies: SessionPolicy[] = Array.isArray(branch)
      ? (swapAction(target, selector, branch).policies ?? [])
      : [{ type: 'arg-policy', valueLimitPerUse: 0n, expression: branch }]
    actions.push({ target, selector, policies })
    return
  }
  const expression = Array.isArray(branch) ? allOf(branch) : branch
  const existing = actions[index]
  const policies = existing.policies ?? []
  const layer = policies.find(isParamsPolicy)
  if (layer === undefined) {
    throw new Error(
      `crossChainPermits (internal): the (${target}, ${selector}) action has no params policy for allowFees to join`,
    )
  }
  const layerExpression =
    layer.type === 'universal-action' ? allOf(layer.rules) : layer.expression
  // The fee branch first: its pin fails fast for the layer's own call, and a
  // fee call it admits never reaches (or counts against) the layer's cap.
  actions[index] = {
    ...existing,
    policies: policies.map((p) =>
      p === layer
        ? {
            type: 'arg-policy',
            valueLimitPerUse: layer.valueLimitPerUse ?? 0n,
            expression: anyOf([expression, layerExpression]),
          }
        : p,
    ),
  }
}

/** Add the fee calls to a session scoped on `chainId`. */
export function withFeeActions(
  actions: readonly ScopedAction[],
  sourceTokens: readonly Address[],
  fees: Fees,
  chainId: number,
): ScopedAction[] {
  const out = [...actions]
  // Usage-limited rules go last: a passing limited rule counts even if its
  // branch then fails.
  const cap = () => cumulativeOnly(32n, settlementFeeCap(chainId))
  for (const token of sourceTokens) {
    addFeeBranch(out, token, TRANSFER_SELECTOR, [
      pin(0n, fees.appFeeCollector),
      cap(),
    ])
    // approve(paymaster, 0) passes too: tokens like USDT need the reset.
    addFeeBranch(out, token, APPROVE_SELECTOR, [pin(0n, fees.paymaster), cap()])
  }
  // One cap rule after the OR, so every token draws on the same budget.
  addFeeBranch(
    out,
    fees.paymaster,
    CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR,
    sourceTokens.length === 1
      ? [pin(0n, sourceTokens[0]), cap()]
      : {
          type: 'and',
          left: anyOf(sourceTokens.map((token) => allOf([pin(0n, token)]))),
          right: allOf([cap()]),
        },
  )
  return out
}
