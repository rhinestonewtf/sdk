import { type Address, isAddressEqual, zeroAddress } from 'viem'
import { refusal } from '../refusals'
import {
  APPROVE_SELECTOR,
  type ServedFees,
  withFeeActions,
} from '../settlement/fees'
import { NATIVE_SENTINEL } from '../settlement/same-chain'
import { cumulativeCap, pin, swapAction } from '../swap/rules'
import { PERMIT2 } from '../swap/stable-floor'
import type { CrossChainPermit, Permission, ScopedAction } from '../types'

/** `deposit()` on the wrapped native token. */
export const DEPOSIT_SELECTOR = '0xd0e30db0' as const

export const isNativeToken = (token: Address): boolean =>
  isAddressEqual(token, zeroAddress) || isAddressEqual(token, NATIVE_SENTINEL)

/** The `from` tokens on `chainId`, each with the largest `maxAmount` of its legs, or none if one leg has none. */
export function permit2SourceTokens(
  permits: readonly CrossChainPermit[],
  chainId: number,
): Map<Address, bigint | undefined> {
  const caps = new Map<string, [Address, bigint | undefined]>()
  for (const { chain, token, maxAmount } of permits.flatMap(
    ({ from }) => from ?? [],
  )) {
    if (chain.id !== chainId) continue
    const seen = caps.get(token.toLowerCase())
    // One settlement draws on one permit, so the largest cap covers it; a sum
    // would let one approval exceed every leg's cap.
    caps.set(token.toLowerCase(), [
      seen?.[0] ?? token,
      !seen
        ? maxAmount
        : seen[1] === undefined || maxAmount === undefined
          ? undefined
          : seen[1] > maxAmount
            ? seen[1]
            : maxAmount,
    ])
  }
  return new Map(caps.values())
}

/**
 * The scoped actions a Permit2-route permit settles through: per `from` token,
 * `approve(Permit2, amount)` capped cumulatively at its largest `maxAmount`;
 * the wrapped-native `deposit()`, its value capped, when `wrap` is given;
 * and the fee calls when `fees` is. A declared approve on a `from` token is
 * refused: the permit adds its own.
 */
export function permit2RouteScope(
  sourceTokens: ReadonlyMap<Address, bigint | undefined>,
  permissions: readonly Permission[],
  declaredActions: readonly ScopedAction[],
  fees: ServedFees | undefined,
  wrap?: { readonly token: Address; readonly cap: bigint },
): ScopedAction[] {
  refuseDeclaredApproves(
    sourceTokens.keys(),
    permissions,
    declaredActions,
    'the permit adds its own',
  )
  const actions: ScopedAction[] = []
  for (const [token, cap] of sourceTokens) {
    actions.push(
      swapAction(token, APPROVE_SELECTOR, [
        pin(0n, PERMIT2),
        ...(cap === undefined ? [] : [cumulativeCap(32n, cap)]),
      ]),
    )
  }
  if (wrap) {
    actions.push({
      target: wrap.token,
      selector: DEPOSIT_SELECTOR,
      policies: [{ type: 'value-limit', limit: wrap.cap }],
    })
  }
  return fees === undefined
    ? actions
    : withFeeActions(actions, [...sourceTokens.keys()], fees)
}

/**
 * The fee calls of a `fallback` session's Permit2-route permit: the capped
 * transfer to the fee collector and the paymaster callback. An exact
 * (token, approve) action would replace the wildcard for every approve of that
 * token, so approves, the paymaster's included, are left to the wildcard.
 */
export function permit2FallbackScope(
  sourceTokens: ReadonlyMap<Address, bigint | undefined>,
  permissions: readonly Permission[],
  declaredActions: readonly ScopedAction[],
  fees: ServedFees | undefined,
): ScopedAction[] {
  refuseDeclaredApproves(
    sourceTokens.keys(),
    permissions,
    declaredActions,
    'the fallback admits its approves',
  )
  return fees === undefined
    ? []
    : withFeeActions([], [...sourceTokens.keys()], fees, { approve: false })
}

function refuseDeclaredApproves(
  tokens: Iterable<Address>,
  permissions: readonly Permission[],
  declaredActions: readonly ScopedAction[],
  why: string,
): void {
  for (const token of tokens) {
    if (
      permissions.some(
        ({ address, functions }) =>
          isAddressEqual(address, token) && functions.approve,
      ) ||
      declaredActions.some(
        ({ target, selector }) =>
          isAddressEqual(target, token) && selector === APPROVE_SELECTOR,
      )
    ) {
      throw refusal(
        'PERMIT2_APPROVE_CONFLICT',
        `crossChainPermits: drop the declared approve on ${token}; ${why}`,
      )
    }
  }
}
