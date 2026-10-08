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
// The constructor takes the IntentExecutor, so each environment has its own.
export const ONE_TIME_USE_ID_POLICY_ADDRESS: Address =
  '0x630CEbCf54C7471154CF659088CC4197872Cf5FD'
export const ONE_TIME_USE_ID_POLICY_ADDRESS_DEV: Address =
  '0x86F7cB4E25626d6a07cfED305c38816F30d07224'

// Chains where the address has code, checked with eth_getCode. A chain absent
// here gets no default, so a session never points at an empty address.
const ONE_TIME_USE_ID_POLICY_CHAINS_DEV: readonly number[] = [
  1, 10, 56, 100, 130, 137, 143, 146, 196, 480, 999, 1868, 2020, 4663, 5042,
  8453, 9745, 42161, 43114, 57073, 84532, 421614, 747474,
]
const ONE_TIME_USE_ID_POLICY_CHAINS: readonly number[] = [
  ...ONE_TIME_USE_ID_POLICY_CHAINS_DEV,
  9746,
  11155111,
  11155420,
]

/** The deployed OneTimeUseIdPolicy on a chain, or undefined where there is none. */
export function defaultOneTimeUseIdPolicy(
  chainId: number,
  environment: 'production' | 'development',
): Address | undefined {
  if (environment === 'development') {
    return ONE_TIME_USE_ID_POLICY_CHAINS_DEV.includes(chainId)
      ? ONE_TIME_USE_ID_POLICY_ADDRESS_DEV
      : undefined
  }
  return ONE_TIME_USE_ID_POLICY_CHAINS.includes(chainId)
    ? ONE_TIME_USE_ID_POLICY_ADDRESS
    : undefined
}

export interface ResolvedPolicyAddresses {
  readonly sudo: Address
  readonly universalAction: Address
  readonly argPolicy: Address
  readonly spendingLimits: Address
  readonly timeFrame: Address
  readonly usageLimit: Address
  readonly valueLimit: Address
  // Absent when neither overridden nor deployed on the session's chain.
  readonly oneTimeUseId?: Address
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
  deployment?: {
    readonly chainId: number
    readonly environment: 'production' | 'development'
  },
): ResolvedPolicyAddresses {
  const oneTimeUseId =
    overrides?.oneTimeUseId ??
    (deployment &&
      defaultOneTimeUseIdPolicy(deployment.chainId, deployment.environment))
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
    ...(oneTimeUseId ? { oneTimeUseId } : {}),
  }
}
