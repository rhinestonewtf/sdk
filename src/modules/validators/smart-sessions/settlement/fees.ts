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
import { STABLE_DECIMALS } from '../swap/stable-floor'
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

/** The per-call cap in whole USD where a chain has no entry below. */
const DEFAULT_SETTLEMENT_FEE_USD = 5n

/** Chains whose per-call cap differs from the default, in whole USD. */
const SETTLEMENT_FEE_USD_BY_CHAIN: Readonly<Record<number, bigint>> = {
  // Ethereum mainnet: a session enable needs a gas refund above 5 USD.
  1: 30n,
}

/**
 * The per-call fee cap on `chainId` in raw units of a stablecoin with
 * `decimals`. Cumulative: the burning transaction admits every later op.
 */
export function settlementFeeCap(chainId: number, decimals: number): bigint {
  const usd = SETTLEMENT_FEE_USD_BY_CHAIN[chainId] ?? DEFAULT_SETTLEMENT_FEE_USD
  return usd * 10n ** BigInt(decimals)
}

const TRANSFER_SELECTOR = toFunctionSelector('transfer(address,uint256)')
export const APPROVE_SELECTOR = toFunctionSelector('approve(address,uint256)')
export const CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR = toFunctionSelector(
  'callbackAllowMaxAmount(address,uint256)',
)

type Fees = NonNullable<SettlementAddresses['fees']>

/** The fee addresses, with the per-call cap in the `from` tokens' raw units. */
export type ServedFees = Fees & { readonly cap: bigint }

type ParamsPolicy = Extract<
  SessionPolicy,
  { type: 'universal-action' | 'arg-policy' }
>

const isParamsPolicy = (policy: SessionPolicy): policy is ParamsPolicy =>
  policy.type === 'universal-action' || policy.type === 'arg-policy'

/** The chain's fee addresses and cap, once every `from` token is one the layers serve with known decimals. */
export function servedFees(
  settlement: SettlementCatalog | undefined,
  chainId: number,
  sourceTokens: readonly Address[],
): ServedFees {
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
  }
  // The cap scales by the token's served decimals; a wrong scale moves it by
  // orders of magnitude, so unknown decimals fail closed.
  const decimals = sourceTokens.map((token) => {
    const listed = (chain.usdStablecoins ?? []).filter((t) =>
      isAddressEqual(t.address, token),
    )
    const why =
      listed.length === 0
        ? 'is not listed in usdStablecoins'
        : listed.length > 1
          ? `appears ${listed.length} times in usdStablecoins`
          : !STABLE_DECIMALS.has(listed[0].decimals)
            ? `is served with ${listed[0].decimals} decimals; expected 6 or 18`
            : undefined
    if (why !== undefined) {
      throw refusal(
        'ALLOW_FEES_NON_STABLECOIN',
        `crossChainPermits: allowFees caps fees in USD, so every \`from\` token must be a served USD stablecoin with known decimals; ${token} on chain ${chainId} ${why}`,
        { chainId },
      )
    }
    return listed[0].decimals
  })
  // The callback's one cap is shared across tokens, so it needs one scale.
  if (new Set(decimals).size > 1) {
    throw refusal(
      'ALLOW_FEES_MIXED_DECIMALS',
      `crossChainPermits: allowFees shares one callback cap across \`from\` tokens, so they must have the same decimals; on chain ${chainId} they have ${[...new Set(decimals)].join(' and ')}`,
      { chainId },
    )
  }
  // No `from` token leaves only the callback, at main's 6-decimal scale.
  return { ...chain.fees, cap: settlementFeeCap(chainId, decimals[0] ?? 6) }
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

/** Add the fee calls to a scoped session; without `approve`, all but the paymaster approve. */
export function withFeeActions(
  actions: readonly ScopedAction[],
  sourceTokens: readonly Address[],
  fees: ServedFees,
  { approve = true }: { readonly approve?: boolean } = {},
): ScopedAction[] {
  const out = [...actions]
  // Usage-limited rules go last: a passing limited rule counts even if its
  // branch then fails.
  const cap = () => cumulativeOnly(32n, fees.cap)
  for (const token of sourceTokens) {
    addFeeBranch(out, token, TRANSFER_SELECTOR, [
      pin(0n, fees.appFeeCollector),
      cap(),
    ])
    // approve(paymaster, 0) passes too: tokens like USDT need the reset.
    if (approve) {
      addFeeBranch(out, token, APPROVE_SELECTOR, [
        pin(0n, fees.paymaster),
        cap(),
      ])
    }
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
