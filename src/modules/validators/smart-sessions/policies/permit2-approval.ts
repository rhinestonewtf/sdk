import {
  type AbiFunction,
  type Address,
  isAddressEqual,
  toFunctionSelector,
} from 'viem'
import { refusal } from '../refusals'
import { withFeeActions } from '../settlement/fees'
import type { SettlementAddresses } from '../settlement/types'
import { cumulativeCap, pin, swapAction } from '../swap/rules'
import { PERMIT2 } from '../swap/stable-floor'
import type { CrossChainPermit, Permission, ScopedAction } from '../types'

const APPROVE_SELECTOR = toFunctionSelector('approve(address,uint256)')

/** The `from` tokens on `chainId`, each with the largest `maxAmount` of its legs, or none if one leg has none. */
export function permit2SourceTokens(
  permits: readonly CrossChainPermit[],
  chainId: number,
): Map<Address, bigint | undefined> {
  const caps = new Map<Address, bigint | undefined>()
  for (const { chain, token, maxAmount } of permits.flatMap(
    ({ from }) => from ?? [],
  )) {
    if (chain.id !== chainId) continue
    const key = [...caps.keys()].find((seen) => isAddressEqual(seen, token))
    if (key === undefined) {
      caps.set(token, maxAmount)
      continue
    }
    // One settlement draws on one permit, so the largest cap covers it; a sum
    // would let one approval exceed every leg's cap.
    const seen = caps.get(key)
    caps.set(
      key,
      seen === undefined || maxAmount === undefined
        ? undefined
        : seen > maxAmount
          ? seen
          : maxAmount,
    )
  }
  return caps
}

/**
 * The scoped actions a Permit2-route permit settles through: per `from` token
 * on the session's chain, `approve(Permit2, amount)` capped cumulatively at its
 * largest `maxAmount`, plus the fee calls when `fees` is given. A declared
 * approve on the token takes Permit2 as one more spender when both are plain
 * spender pins; any other collision is refused.
 */
export function permit2RouteScope(
  sourceTokens: ReadonlyMap<Address, bigint | undefined>,
  permissions: readonly Permission[],
  declaredActions: readonly ScopedAction[],
  fees: NonNullable<SettlementAddresses['fees']> | undefined,
): { permissions: Permission[]; actions: ScopedAction[] } {
  const out = [...permissions]
  const actions: ScopedAction[] = []
  for (const [token, cap] of sourceTokens) {
    const index = out.findIndex(
      ({ address, functions }) =>
        isAddressEqual(address, token) && functions.approve,
    )
    const raw = declaredActions.some(
      ({ target, selector }) =>
        isAddressEqual(target, token) && selector === APPROVE_SELECTOR,
    )
    if (index === -1 && !raw) {
      actions.push(
        swapAction(token, APPROVE_SELECTOR, [
          pin(0n, PERMIT2),
          ...(cap === undefined ? [] : [cumulativeCap(32n, cap)]),
        ]),
      )
      continue
    }
    const permission = out[index]
    const entry = permission?.abi.find(
      (item): item is AbiFunction =>
        item.type === 'function' && item.name === 'approve',
    )
    const { params = {}, ...rest } = permission?.functions.approve ?? {}
    const name = entry?.inputs[0]?.name ?? ''
    const rule = (params[name] ?? {}) as {
      condition?: string
      value?: Address
      anyOf?: Address[]
    }
    const spenders =
      rule.anyOf ?? (rule.condition === 'equal' ? [rule.value] : undefined)
    // One action keeps one counter per policy, so a cap or a fee branch would
    // bind the Permit2 approval and the declared one together.
    if (
      raw ||
      cap !== undefined ||
      fees !== undefined ||
      !spenders ||
      !entry ||
      toFunctionSelector(entry) !== APPROVE_SELECTOR ||
      Object.keys(rest).length ||
      Object.keys(params).length > 1 ||
      Object.keys(rule).some(
        (k) => !['condition', 'value', 'anyOf'].includes(k),
      )
    ) {
      throw refusal(
        'PERMIT2_APPROVE_CONFLICT',
        `crossChainPermits: the approve on ${token} cannot also admit Permit2`,
      )
    }
    if (!spenders.some((s) => s !== undefined && isAddressEqual(s, PERMIT2))) {
      out[index] = {
        ...permission,
        functions: {
          ...permission.functions,
          approve: { params: { [name]: { anyOf: [...spenders, PERMIT2] } } },
        },
      } as Permission
    }
  }
  return {
    permissions: out,
    actions:
      fees === undefined
        ? actions
        : withFeeActions(actions, [...sourceTokens.keys()], fees),
  }
}
