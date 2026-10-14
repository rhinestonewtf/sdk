import { type Hex, slice } from 'viem'
import type {
  ArgPolicyExpression,
  ScopedAction,
  UniversalActionPolicyParamRule,
} from '../../src/modules/validators/smart-sessions/types'

/** Per-rule usage counters, carried across calls like the policies' storage. */
export type RuleUsage = Map<UniversalActionPolicyParamRule, bigint>

/**
 * Whether `calldata` satisfies a scoped action's argument rules, read the way
 * the on-chain policies read them: one word at `4 + calldataOffset`.
 * `observed` is either the amount every cumulative rule has already counted,
 * or a `RuleUsage` map updated as the chain would: a passing limited rule
 * counts even when its branch later fails, and nothing counts if the call is
 * refused (the transaction reverts).
 */
export function satisfiesRules(
  action: ScopedAction,
  calldata: Hex,
  observed: bigint | RuleUsage = 0n,
): boolean {
  const usage = typeof observed === 'bigint' ? undefined : new Map(observed)
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
    if (!holds || r.usageLimit === undefined) return holds
    const used = usage ? (usage.get(r) ?? 0n) : (observed as bigint)
    if (used + value > r.usageLimit) return false
    usage?.set(r, used + value)
    return true
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
  const passed = installed.every((policy) =>
    policy.type === 'universal-action'
      ? policy.rules.every(rule)
      : policy.type === 'arg-policy'
        ? expr(policy.expression)
        : true,
  )
  if (passed && usage && typeof observed !== 'bigint') {
    for (const [r, used] of usage) observed.set(r, used)
  }
  return passed
}
