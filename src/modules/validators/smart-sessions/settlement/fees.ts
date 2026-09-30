import { type Address, isAddressEqual, toFunctionSelector } from 'viem'
import { resolvePermissions } from '../../permissions'
import { allOf, anyOf, cumulativeCap, pin } from '../swap/rules'
import type {
  ArgPolicyExpression,
  Permission,
  ScopedAction,
  SessionPolicy,
} from '../types'
import type { SettlementAddresses, SettlementCatalog } from './types'

/**
 * `allowFees` (RHI-7884): the app-fee transfer and the unsponsored-gas paymaster
 * calls the orchestrator adds before the layer calls, each capped at 5 USD.
 */

/** 5 USD at 6 decimals. Cumulative: the burning transaction admits every later op. */
export const SETTLEMENT_FEE_CAP = 5_000_000n

const TRANSFER_SELECTOR = toFunctionSelector('transfer(address,uint256)')
const APPROVE_SELECTOR = toFunctionSelector('approve(address,uint256)')
export const CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR = toFunctionSelector(
  'callbackAllowMaxAmount(address,uint256)',
)

type Fees = NonNullable<SettlementAddresses['fees']>

/** The chain's fee addresses, once every `from` token is a served USD stablecoin. */
export function servedFees(
  settlement: SettlementCatalog | undefined,
  chainId: number,
  sourceTokens: readonly Address[],
): Fees {
  if (settlement === undefined) {
    throw new Error(
      "crossChainPermits: allowFees needs the orchestrator's settlement addresses; create the session with sdk.createSession",
    )
  }
  const chain = settlement[chainId]
  if (chain?.fees === undefined) {
    throw new Error(
      `crossChainPermits: the orchestrator serves no fee addresses on chain ${chainId}, so allowFees cannot be scoped there`,
    )
  }
  // The cap is in 6-decimal USD units, so it only bounds a 6-decimal stablecoin;
  // the layers' served stable sets are the SDK's list of those.
  const stables = [
    chain.cctp?.usdc,
    chain.oft?.token,
    ...(chain.eco?.stablecoins ?? []),
    chain.lz?.stargateUsdc?.token,
    chain.lz?.cctp?.token,
  ].filter((token): token is Address => token !== undefined)
  for (const token of sourceTokens) {
    if (!stables.some((stable) => isAddressEqual(stable, token))) {
      throw new Error(
        `crossChainPermits: allowFees caps fees in USD, so every \`from\` token must be a served USD stablecoin; ${token} on chain ${chainId} is not`,
      )
    }
  }
  return chain.fees
}

/**
 * Turn the swap scope's approve permissions into raw actions, so the paymaster
 * approve can join them. The spending limit becomes a cumulative cap on the
 * swap branch: a shared limit would count the fee approves against the swap.
 */
export function permissionsAsActions(
  permissions: readonly Permission[],
  cap: bigint,
): ScopedAction[] {
  if (permissions.length === 0) return []
  return resolvePermissions([...permissions]).map((action) => {
    if (!('target' in action) || action.selector !== APPROVE_SELECTOR) {
      throw new Error(
        'crossChainPermits: allowFees expected only approve permissions from the swap scope',
      )
    }
    const policies = action.policies ?? []
    return {
      ...action,
      policies: policies
        .filter((policy) => policy.type !== 'spending-limits')
        .map((policy) =>
          policy.type === 'universal-action' || policy.type === 'arg-policy'
            ? asArgPolicy(policy, [cumulativeCap(32n, cap)])
            : policy,
        ),
    }
  })
}

/** A params policy as one expression, with `extra` rules ANDed after it. */
function asArgPolicy(
  policy: Extract<SessionPolicy, { type: 'universal-action' | 'arg-policy' }>,
  extra: Parameters<typeof allOf>[0] = [],
): Extract<SessionPolicy, { type: 'arg-policy' }> {
  const base =
    policy.type === 'universal-action' ? allOf(policy.rules) : policy.expression
  return {
    type: 'arg-policy',
    valueLimitPerUse: policy.valueLimitPerUse ?? 0n,
    expression: extra.length
      ? { type: 'and', left: base, right: allOf(extra) }
      : base,
  }
}

/**
 * Add the fee calls to a scoped session. A call the layer already makes (its
 * approve, SAME_CHAIN_IE's transfer) gets the fee branch ORed into its one params
 * policy, since the chain keeps a single config per policy and action.
 */
export function withFeeActions(
  actions: readonly ScopedAction[],
  sourceTokens: readonly Address[],
  fees: Fees,
  timeFrame: readonly SessionPolicy[],
): ScopedAction[] {
  const out = [...actions]
  // Usage-limited rules go last: a passing limited rule counts even if its
  // branch then fails.
  const add = (
    target: Address,
    selector: `0x${string}`,
    branch: ArgPolicyExpression,
  ) => {
    const index = out.findIndex(
      (a) => isAddressEqual(a.target, target) && a.selector === selector,
    )
    if (index === -1) {
      out.push({
        target,
        selector,
        policies: [
          { type: 'arg-policy', valueLimitPerUse: 0n, expression: branch },
          ...timeFrame,
        ],
      })
      return
    }
    const existing = out[index]
    const policies = existing.policies ?? []
    const params = policies.findIndex(
      (p) => p.type === 'universal-action' || p.type === 'arg-policy',
    )
    if (params === -1) {
      throw new Error(
        `crossChainPermits: the (${target}, ${selector}) action has no params policy for allowFees to join`,
      )
    }
    const layer = asArgPolicy(
      policies[params] as Extract<
        SessionPolicy,
        { type: 'universal-action' | 'arg-policy' }
      >,
    )
    // The fee branch first: its pin fails fast for the layer's own call, and a
    // fee call it admits never reaches (or counts against) the layer's cap.
    out[index] = {
      ...existing,
      policies: policies.map((p, i) =>
        i === params
          ? { ...layer, expression: anyOf([branch, layer.expression]) }
          : p,
      ),
    }
  }
  for (const token of sourceTokens) {
    add(
      token,
      TRANSFER_SELECTOR,
      allOf([
        pin(0n, fees.appFeeCollector),
        cumulativeCap(32n, SETTLEMENT_FEE_CAP),
      ]),
    )
    // approve(paymaster, 0) passes too: tokens like USDT need the reset.
    add(
      token,
      APPROVE_SELECTOR,
      allOf([pin(0n, fees.paymaster), cumulativeCap(32n, SETTLEMENT_FEE_CAP)]),
    )
  }
  add(fees.paymaster, CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR, {
    type: 'and',
    left: anyOf(
      sourceTokens.map(
        (token): ArgPolicyExpression => ({
          type: 'rule',
          rule: pin(0n, token),
        }),
      ),
    ),
    right: { type: 'rule', rule: cumulativeCap(32n, SETTLEMENT_FEE_CAP) },
  })
  return out
}
