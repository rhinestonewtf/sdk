import { type Hex, slice } from 'viem'
import type {
  ArgPolicyExpression,
  ScopedAction,
  UniversalActionPolicyParamRule,
} from '../../src/modules/validators/smart-sessions/types'

/**
 * Whether `calldata` satisfies a scoped action's argument rules, read the way
 * the on-chain policies read them: one word at `4 + calldataOffset`.
 * `observed` is the amount a cumulative rule has already counted.
 */
export function satisfiesRules(
  action: ScopedAction,
  calldata: Hex,
  observed = 0n,
): boolean {
  const word = (offset: bigint) =>
    BigInt(slice(calldata, 4 + Number(offset), 36 + Number(offset)))
  const rule = (r: UniversalActionPolicyParamRule) => {
    const ref = BigInt(r.referenceValue)
    const value = word(r.calldataOffset)
    if (r.condition === 'equal') return value === ref
    if (r.condition === 'greaterThan') return value > ref
    if (r.condition === 'greaterThanOrEqual') return value >= ref
    if (r.condition === 'lessThanOrEqual')
      return (
        value <= ref &&
        (r.usageLimit === undefined || observed + value <= r.usageLimit)
      )
    throw new Error(`unexpected condition ${r.condition}`)
  }
  const expr = (e: ArgPolicyExpression): boolean =>
    e.type === 'rule'
      ? rule(e.rule)
      : e.type === 'not'
        ? !expr(e.child)
        : e.type === 'and'
          ? expr(e.left) && expr(e.right)
          : expr(e.left) || expr(e.right)
  return (action.policies ?? []).every((policy) =>
    policy.type === 'universal-action'
      ? policy.rules.every(rule)
      : policy.type === 'arg-policy'
        ? expr(policy.expression)
        : true,
  )
}
