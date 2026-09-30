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
    const holds =
      r.condition === 'equal'
        ? value === ref
        : r.condition === 'greaterThan'
          ? value > ref
          : r.condition === 'greaterThanOrEqual'
            ? value >= ref
            : r.condition === 'lessThanOrEqual'
              ? value <= ref
              : undefined
    if (holds === undefined) {
      throw new Error(`unexpected condition ${r.condition}`)
    }
    // The policies count a limited rule under any condition.
    return (
      holds && (r.usageLimit === undefined || observed + value <= r.usageLimit)
    )
  }
  const expr = (e: ArgPolicyExpression): boolean =>
    e.type === 'rule'
      ? rule(e.rule)
      : e.type === 'not'
        ? !expr(e.child)
        : e.type === 'and'
          ? expr(e.left) && expr(e.right)
          : expr(e.left) || expr(e.right)
  // The chain keeps one config per policy contract and action: a later policy of
  // the same kind overwrites an earlier one instead of ANDing with it.
  const policies = action.policies ?? []
  const installed = policies.filter(
    (policy, i) => !policies.slice(i + 1).some((p) => p.type === policy.type),
  )
  return installed.every((policy) =>
    policy.type === 'universal-action'
      ? policy.rules.every(rule)
      : policy.type === 'arg-policy'
        ? expr(policy.expression)
        : true,
  )
}
