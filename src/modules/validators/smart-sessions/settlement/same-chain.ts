import {
  type Address,
  isAddressEqual,
  toFunctionSelector,
  zeroAddress,
} from 'viem'
import { swapperAddresses } from '../swap/rhinestone'
import { cumulativeCap, pin, swapAction } from '../swap/rules'
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
const SWAPPER_OUTPUT_BOUND_OFFSET = 96n

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
  readonly timeFrame: readonly SessionPolicy[]
  readonly validAfter?: bigint
  readonly validUntil?: bigint
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
  const withTimeFrame = (action: ScopedAction): ScopedAction => ({
    ...action,
    policies: [...(action.policies ?? []), ...ctx.timeFrame],
  })

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
    return { actions: [withTimeFrame(action)], permissions: [] }
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
  const swapper = swapperAddresses(ctx.environment).swapper
  const floor: SessionPolicy = {
    type: 'universal-action',
    valueLimitPerUse: 0n,
    rules: [
      {
        condition: 'greaterThanOrEqual',
        calldataOffset: SWAPPER_OUTPUT_BOUND_OFFSET,
        referenceValue: leg.minAmount,
      },
    ],
  }
  const date = (seconds: bigint) => new Date(Number(seconds) * 1000)
  const window = {
    ...(ctx.validAfter === undefined
      ? {}
      : { validAfter: date(ctx.validAfter) }),
    ...(ctx.validUntil === undefined
      ? {}
      : { validUntil: date(ctx.validUntil) }),
  }
  return {
    actions: swap.actions.map((action) =>
      withTimeFrame(
        isAddressEqual(action.target, swapper)
          ? { ...action, policies: [...(action.policies ?? []), floor] }
          : action,
      ),
    ),
    permissions: swap.permissions.map((permission) => ({
      ...permission,
      functions: Object.fromEntries(
        Object.entries(permission.functions).map(([name, fn]) => [
          name,
          fn && { ...fn, ...window },
        ]),
      ),
    })),
  }
}
