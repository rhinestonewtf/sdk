import type { Address } from 'viem'
import type {
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
export function swapAction(
  target: Address,
  selector: `0x${string}`,
  rules: UniversalActionPolicyParamRule[],
): ScopedAction {
  const policy: SessionPolicy = {
    type: 'universal-action',
    valueLimitPerUse: 0n,
    rules: rules as [
      UniversalActionPolicyParamRule,
      ...UniversalActionPolicyParamRule[],
    ],
  }
  return { target, selector, policies: [policy] }
}

/** What a venue module returns for one configured venue. */
export interface VenueScoping {
  /** ERC-20 spender the session may approve the sell token to. */
  readonly approveSpender: Address
  readonly action: ScopedAction
}

/** Everything a venue needs to know about the swap being scoped. */
export interface VenueContext {
  readonly chainId: number
  readonly sellToken: Address
  readonly buyToken: Address
  readonly recipient: Address
  /** Cumulative sell-token cap, or undefined for no cap. */
  readonly cap: bigint | undefined
}
