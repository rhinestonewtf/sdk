import type { Address, Hex } from 'viem'
import type {
  ArgPolicyExpression,
  ScopedAction,
  SessionPolicy,
  UniversalActionPolicyParamRule,
} from '../types'

/**
 * Shared rule builders for swap-venue scoping.
 *
 * Venue modules describe *what* to pin; these turn that into policy rules with
 * the security-relevant details (cumulative accumulation, zero native value)
 * decided in exactly one place.
 */

/**
 * Pin a calldata word to an exact numeric value.
 *
 * Used for ABI *shape* words — array pointers, lengths, element offsets. Pinning
 * those is what makes pinning anything inside a dynamic tail sound: without
 * them a caller can re-lay-out the encoding so a fixed offset lands on a
 * different word, and the rule silently validates the wrong bytes.
 */
export function pinValue(
  calldataOffset: bigint,
  referenceValue: bigint,
): UniversalActionPolicyParamRule {
  return { condition: 'equal', calldataOffset, referenceValue }
}

/** Pin a calldata word to an exact 32-byte value. */
export function pinWord(
  calldataOffset: bigint,
  referenceValue: Hex,
): UniversalActionPolicyParamRule {
  return { condition: 'equal', calldataOffset, referenceValue }
}

/** Pin a calldata word to an exact address. */
export function pin(
  calldataOffset: bigint,
  referenceValue: Address,
): UniversalActionPolicyParamRule {
  return { condition: 'equal', calldataOffset, referenceValue }
}

/**
 * Cap a swap's own sell amount, cumulatively across every call.
 *
 * `usageLimit` is what makes this cumulative: it sets `isLimited` + `usage.limit`
 * on-chain, so the policy accumulates the observed value and reverts once the
 * running total would exceed the cap.
 *
 * A bare comparison would be per-call, which is not enough. A reusable session
 * could then run N swaps of `cap` each, and any allowance that already existed
 * before the session was created is spent without the approve's spending-limit
 * ever observing it.
 */
export function cumulativeCap(
  calldataOffset: bigint,
  cap: bigint,
): UniversalActionPolicyParamRule {
  return {
    condition: 'lessThanOrEqual',
    calldataOffset,
    referenceValue: cap,
    usageLimit: cap,
  }
}

/**
 * Wrap rules into the action's policy.
 *
 * `valueLimitPerUse: 0n` because the approve cap only bounds ERC-20 pulls —
 * without it, a payable swap selector could still carry arbitrary native value
 * through the router.
 */
/** Every rule must hold, as a right-folded AND over the expression tree. */
function allOf(rules: UniversalActionPolicyParamRule[]): ArgPolicyExpression {
  return rules
    .map((rule): ArgPolicyExpression => ({ type: 'rule', rule }))
    .reduceRight((right, left) => ({ type: 'and', left, right }))
}

/**
 * Wrap rules into the action's policy.
 *
 * `valueLimitPerUse: 0n` because the approve cap only bounds ERC-20 pulls —
 * without it, a payable swap selector could still carry arbitrary native value
 * through the router.
 *
 * UniversalActionPolicy while the rules fit its fixed 16-slot array, which is
 * every venue except a fully-pinned wrapped route — those pin the shape words,
 * both call targets, the approve and the nested exec, and run past 16. ArgPolicy
 * takes a dynamic rule list, so it carries the overflow rather than forcing a
 * pin to be dropped. Preferring the simpler policy keeps the common case on the
 * contract it has always used.
 */
const UNIVERSAL_ACTION_MAX_RULES = 16

export function swapAction(
  target: Address,
  selector: `0x${string}`,
  rules: UniversalActionPolicyParamRule[],
  /**
   * Mutually exclusive rule sets, at least one of which must hold — used when
   * several venues authorise the SAME call but pin its tail to different
   * aggregators. One on-chain action id cannot carry two policies, and dropping
   * the pins to share it would authorise a tail neither venue named, so the
   * alternatives become an OR instead.
   */
  alternatives: UniversalActionPolicyParamRule[][] = [],
): ScopedAction {
  const usable = alternatives.filter((set) => set.length > 0)
  const policy: SessionPolicy =
    usable.length > 0
      ? {
          type: 'arg-policy',
          valueLimitPerUse: 0n,
          expression: {
            type: 'and',
            left: allOf(rules),
            right: usable
              .map(allOf)
              .reduce((left, right) => ({ type: 'or', left, right })),
          },
        }
      : rules.length <= UNIVERSAL_ACTION_MAX_RULES
        ? {
            type: 'universal-action',
            valueLimitPerUse: 0n,
            rules: rules as [
              UniversalActionPolicyParamRule,
              ...UniversalActionPolicyParamRule[],
            ],
          }
        : { type: 'arg-policy', valueLimitPerUse: 0n, expression: allOf(rules) }
  return { target, selector, policies: [policy] }
}

/** What a venue module returns for one configured venue. */
export interface VenueScoping {
  /**
   * ERC-20 spenders the session may approve the sell token to. Plural because a
   * venue reachable by more than one call shape has a different allowance
   * target per shape — 0x direct pulls via its AllowanceHolder, the same swap
   * wrapped pulls via the Swapper's proxy.
   */
  readonly approveSpenders: readonly Address[]
  /**
   * One or more scoped actions. Plural because a venue may expose several
   * entrypoints that are all legitimate for the same scope — the Rhinestone
   * Swapper has separate exact-in and exact-out selectors, and which one the
   * orchestrator picks is its choice, not the caller's.
   */
  readonly actions: readonly ScopedAction[]
}

/** Everything a venue needs to know about the swap being scoped. */
export interface VenueContext {
  readonly chainId: number
  /** Selects the Swapper/proxy deployment pair. */
  readonly environment: 'production' | 'development'
  readonly sellToken: Address
  readonly buyToken: Address
  readonly recipient: Address
  /** Cumulative sell-token cap, or undefined for no cap. */
  readonly cap: bigint | undefined
}
