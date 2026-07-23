import type { Address } from 'viem'
import type { SessionPolicyAddresses } from '../types'

export const SPENDING_LIMITS_POLICY_ADDRESS: Address =
  '0x000000000033212E272655D8a22402Db819477A6'
export const TIME_FRAME_POLICY_ADDRESS: Address =
  '0x0000000000D30f611fA3bf652ac6879428586930'
export const SUDO_POLICY_ADDRESS: Address =
  '0x0000000000FEEc8D74e3143fBaBbca515358d869'
export const UNIVERSAL_ACTION_POLICY_ADDRESS: Address =
  '0x0000000000714Cf48FcF88A0bFBa70d313415032'
export const ARG_POLICY_ADDRESS: Address =
  '0x0000000000167edE64D8751daACDdC0312565a73'
export const USAGE_LIMIT_POLICY_ADDRESS: Address =
  '0x00000000001d4479FA2A947026204d0283ceDe4B'
export const VALUE_LIMIT_POLICY_ADDRESS: Address =
  '0x000000000021dC45451291BCDfc9f0B46d6f0278'
export const INTENT_EXECUTION_POLICY_ADDRESS: Address =
  '0xe9eA54d063975cDee9e06b7636d5563d95a7A23C'
export const INTENT_EXECUTION_POLICY_ADDRESS_DEV: Address =
  '0xa09b47de6e510cbdc18b97e9239bedcb44fb4901'

export interface ResolvedPolicyAddresses {
  readonly sudo: Address
  readonly universalAction: Address
  readonly argPolicy: Address
  readonly spendingLimits: Address
  readonly timeFrame: Address
  readonly usageLimit: Address
  readonly valueLimit: Address
}

export const DEFAULT_POLICY_ADDRESSES: ResolvedPolicyAddresses = Object.freeze({
  sudo: SUDO_POLICY_ADDRESS,
  universalAction: UNIVERSAL_ACTION_POLICY_ADDRESS,
  argPolicy: ARG_POLICY_ADDRESS,
  spendingLimits: SPENDING_LIMITS_POLICY_ADDRESS,
  timeFrame: TIME_FRAME_POLICY_ADDRESS,
  usageLimit: USAGE_LIMIT_POLICY_ADDRESS,
  valueLimit: VALUE_LIMIT_POLICY_ADDRESS,
})

export function resolvePolicyAddresses(
  overrides?: SessionPolicyAddresses,
): ResolvedPolicyAddresses {
  return {
    sudo: overrides?.sudo ?? DEFAULT_POLICY_ADDRESSES.sudo,
    universalAction:
      overrides?.universalAction ?? DEFAULT_POLICY_ADDRESSES.universalAction,
    argPolicy: overrides?.argPolicy ?? DEFAULT_POLICY_ADDRESSES.argPolicy,
    spendingLimits:
      overrides?.spendingLimits ?? DEFAULT_POLICY_ADDRESSES.spendingLimits,
    timeFrame: overrides?.timeFrame ?? DEFAULT_POLICY_ADDRESSES.timeFrame,
    usageLimit: overrides?.usageLimit ?? DEFAULT_POLICY_ADDRESSES.usageLimit,
    valueLimit: overrides?.valueLimit ?? DEFAULT_POLICY_ADDRESSES.valueLimit,
  }
}
