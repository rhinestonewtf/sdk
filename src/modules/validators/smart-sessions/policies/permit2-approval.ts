import { type Address, isAddressEqual, zeroAddress } from 'viem'
import { refusal } from '../refusals'
import { APPROVE_SELECTOR, withFeeActions } from '../settlement/fees'
import { NATIVE_SENTINEL } from '../settlement/same-chain'
import type { SettlementAddresses } from '../settlement/types'
import { cumulativeCap, pin, swapAction } from '../swap/rules'
import { PERMIT2 } from '../swap/stable-floor'
import type { CrossChainPermit, Permission, ScopedAction } from '../types'

// deposit() and withdraw(uint256) on the wrapped native token.
export const DEPOSIT_SELECTOR = '0xd0e30db0' as const
export const WITHDRAW_SELECTOR = '0x2e1a7d4d' as const

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
 * the wrapped-native `deposit()` and `withdraw(uint256)` when `wrap` is given;
 * and the fee calls when `fees` is. A declared approve on a `from` token is
 * refused: the permit adds its own.
 */
export function permit2RouteScope(
  sourceTokens: ReadonlyMap<Address, bigint | undefined>,
  permissions: readonly Permission[],
  declaredActions: readonly ScopedAction[],
  fees: NonNullable<SettlementAddresses['fees']> | undefined,
  wrap?: { readonly token: Address; readonly cap: bigint | undefined },
): ScopedAction[] {
  const actions: ScopedAction[] = []
  for (const [token, cap] of sourceTokens) {
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
        `crossChainPermits: drop the declared approve on ${token}; the permit adds its own`,
      )
    }
    actions.push(
      swapAction(token, APPROVE_SELECTOR, [
        pin(0n, PERMIT2),
        ...(cap === undefined ? [] : [cumulativeCap(32n, cap)]),
      ]),
    )
  }
  if (wrap) {
    const { token, cap } = wrap
    actions.push(
      {
        target: token,
        selector: DEPOSIT_SELECTOR,
        ...(cap !== undefined && {
          policies: [{ type: 'value-limit', limit: cap }],
        }),
      },
      cap === undefined
        ? { target: token, selector: WITHDRAW_SELECTOR }
        : swapAction(token, WITHDRAW_SELECTOR, [cumulativeCap(0n, cap)]),
    )
  }
  return fees === undefined
    ? actions
    : withFeeActions(actions, [...sourceTokens.keys()], fees)
}
