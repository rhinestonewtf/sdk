import {
  type Abi,
  type Address,
  isAddressEqual,
  toFunctionSelector,
  zeroAddress,
} from 'viem'
import { namedParamOffsets } from '../../permissions'
import { swapperAbi } from '../swap/rhinestone'
import {
  cumulativeCap,
  pin,
  swapAction,
  UNIVERSAL_ACTION_MAX_RULES,
} from '../swap/rules'
import { resolveSwapScope } from '../swap/scope'
import type {
  ArgPolicyExpression,
  Permission,
  ScopedAction,
  SessionPolicy,
  UniversalActionPolicyParamRule,
} from '../types'

/**
 * SAME_CHAIN_IE — a smart account settling on its own chain through the
 * IntentExecutor: a plain `transfer` when the token does not change, or a
 * Rhinestone Swapper swap (the existing `swap` scope) with a pinned output
 * floor when it does.
 */

const TRANSFER_SELECTOR = toFunctionSelector('transfer(address,uint256)')
const NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

/**
 * The Swapper's output bound, at the same head word in both entrypoints:
 * `minAmountOut` for `swapExactIn`, `amountOut` for `swapExactOut`.
 */
export const SWAPPER_OUTPUT_BOUND_OFFSET = namedParamOffsets(
  swapperAbi as unknown as Abi,
  'swapExactIn',
).minAmountOut

/**
 * Add a rule to an action's params policy. It must join the existing policy:
 * the chain keeps one config per policy contract and action, so a second
 * policy of the same kind would overwrite the first rather than AND with it.
 */
export function withRule(
  policy: SessionPolicy,
  rule: UniversalActionPolicyParamRule,
): SessionPolicy {
  if (policy.type === 'arg-policy') {
    return {
      ...policy,
      expression: {
        type: 'and',
        left: policy.expression,
        right: { type: 'rule', rule },
      },
    }
  }
  if (policy.type !== 'universal-action') return policy
  if (policy.rules.length < UNIVERSAL_ACTION_MAX_RULES) {
    return { ...policy, rules: [...policy.rules, rule] }
  }
  return {
    type: 'arg-policy',
    ...(policy.valueLimitPerUse === undefined
      ? {}
      : { valueLimitPerUse: policy.valueLimitPerUse }),
    expression: [...policy.rules, rule]
      .map((r): ArgPolicyExpression => ({ type: 'rule', rule: r }))
      .reduceRight((right, left) => ({ type: 'and', left, right })),
  }
}

export interface SameChainContext {
  readonly chainId: number
  readonly environment: 'production' | 'development'
  readonly account: Address | undefined
  readonly sourceTokens: readonly Address[]
  readonly destinations: readonly {
    readonly chainId: number
    readonly token: Address
    readonly recipient?: Address
    readonly minAmount?: bigint
  }[]
  readonly cap?: bigint
}

export interface SameChainScope {
  readonly actions: ScopedAction[]
  readonly permissions: Permission[]
}

/** A transfer pinned only to one of several recipients. */
function recipientsOnly(
  token: Address,
  recipients: readonly Address[],
): ScopedAction {
  // swapAction needs shared rules to AND the alternatives onto, so a bare OR
  // is built here.
  const expression = recipients
    .map(
      (recipient): ArgPolicyExpression => ({
        type: 'rule',
        rule: pin(0n, recipient),
      }),
    )
    .reduce((left, right) => ({ type: 'or', left, right }))
  return {
    target: token,
    selector: TRANSFER_SELECTOR,
    policies: [{ type: 'arg-policy', valueLimitPerUse: 0n, expression }],
  }
}

export function scopeSameChain(ctx: SameChainContext): SameChainScope {
  if (ctx.sourceTokens.length !== 1) {
    throw new Error(
      'crossChainPermits: SAME_CHAIN_IE spends one token; give exactly one `from` token on this chain',
    )
  }
  const [token] = ctx.sourceTokens
  // The orchestrator moves native value as a plain value call or a payable
  // swap, neither of which these ERC-20 scopes admit.
  if (
    isAddressEqual(token, zeroAddress) ||
    isAddressEqual(token, NATIVE_SENTINEL)
  ) {
    throw new Error(
      'crossChainPermits: SAME_CHAIN_IE spends an ERC-20; a native `from` token is not supported',
    )
  }
  const elsewhere = ctx.destinations.find((leg) => leg.chainId !== ctx.chainId)
  if (elsewhere) {
    throw new Error(
      `crossChainPermits: SAME_CHAIN_IE settles on chain ${ctx.chainId}; a \`to\` leg names chain ${elsewhere.chainId}`,
    )
  }

  const sameToken = ctx.destinations.map((leg) =>
    isAddressEqual(leg.token, token),
  )
  if (sameToken.every(Boolean)) {
    if (ctx.destinations.some((leg) => leg.minAmount !== undefined)) {
      throw new Error(
        'crossChainPermits: `to.minAmount` applies only to a SAME_CHAIN_IE swap',
      )
    }
    const rules: UniversalActionPolicyParamRule[] =
      ctx.cap === undefined ? [] : [cumulativeCap(32n, ctx.cap)]
    const recipients = ctx.destinations.map((leg) => leg.recipient)
    const account = ctx.account
    // The orchestrator never transfers a token to the account that holds it.
    if (
      account &&
      recipients.every((r) => r !== undefined && isAddressEqual(r, account))
    ) {
      throw new Error(
        'crossChainPermits: a SAME_CHAIN_IE transfer to the account itself never settles; name another recipient',
      )
    }
    // An open leg ('any', opted into with allowRecipientNotAccount) lifts the
    // recipient pin for the whole transfer.
    const pinned = recipients.every((r) => r !== undefined)
      ? (recipients as Address[])
      : []
    if (pinned.length === 0 && rules.length === 0) {
      throw new Error(
        "crossChainPermits: a SAME_CHAIN_IE transfer to 'any' recipient needs maxAmount; otherwise it authorises every transfer of the token",
      )
    }
    const action =
      pinned.length <= 1
        ? swapAction(token, TRANSFER_SELECTOR, [
            ...rules,
            ...pinned.map((recipient) => pin(0n, recipient)),
          ])
        : rules.length > 0
          ? swapAction(
              token,
              TRANSFER_SELECTOR,
              rules,
              pinned.map((recipient) => [pin(0n, recipient)]),
            )
          : recipientsOnly(token, pinned)
    return { actions: [action], permissions: [] }
  }
  if (sameToken.some(Boolean) || ctx.destinations.length !== 1) {
    throw new Error(
      'crossChainPermits: SAME_CHAIN_IE either transfers the `from` token or swaps it into exactly one `to` token',
    )
  }
  const [leg] = ctx.destinations
  if (leg.recipient === undefined) {
    throw new Error(
      "crossChainPermits: a SAME_CHAIN_IE swap needs a concrete recipient; 'any' cannot pin the swap output",
    )
  }
  // The key passes the Swapper's output bound and its route, so without a
  // floor it could route the pulled input anywhere and accept nothing back.
  if (leg.minAmount === undefined || leg.minAmount <= 0n) {
    throw new Error(
      'crossChainPermits: a SAME_CHAIN_IE swap needs a positive `to.minAmount` to bound what the swap must deliver',
    )
  }
  // The floor is a fixed amount, not a price: only against a capped input does
  // maxAmount : minAmount bound the rate, and the cap brings oneTimeUse.
  if (ctx.cap === undefined) {
    throw new Error(
      'crossChainPermits: a SAME_CHAIN_IE swap needs maxAmount; the floor bounds the rate only against a capped input',
    )
  }
  const swap = resolveSwapScope(
    {
      sell: {
        token,
        ...(ctx.cap === undefined ? {} : { maxTotal: ctx.cap }),
      },
      buy: { token: leg.token },
      to: leg.recipient,
    },
    ctx.chainId,
    ctx.environment,
  )
  const floor: UniversalActionPolicyParamRule = {
    condition: 'greaterThanOrEqual',
    calldataOffset: SWAPPER_OUTPUT_BOUND_OFFSET,
    referenceValue: leg.minAmount,
  }
  return {
    // The bare venue emits only Swapper entrypoints; the floor goes on every
    // action so none can run without it.
    actions: swap.actions.map((action) => {
      const policies = action.policies ?? []
      // The floor rides on the params policy; an action without one would run
      // unfloored.
      if (
        !policies.some(
          (p) => p.type === 'universal-action' || p.type === 'arg-policy',
        )
      ) {
        throw new Error(
          'crossChainPermits: a SAME_CHAIN_IE swap action has no params policy to carry its floor',
        )
      }
      return {
        ...action,
        policies: policies.map((policy) => withRule(policy, floor)),
      }
    }),
    permissions: swap.permissions,
  }
}
