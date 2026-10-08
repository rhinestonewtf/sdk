import { type Address, isAddressEqual } from 'viem'
import { PERMIT2_CLAIM_POLICY_ADDRESS } from '../../policies/claim/permit2'
import { refusal } from '../refusals'
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

/** The refusal for a chain with no OneTimeUseIdPolicy to default to. */
export function oneTimeUseIdPolicyMissing(
  chainId: number,
  environment: 'production' | 'development',
): string {
  return (
    `oneTimeUse: no OneTimeUseIdPolicy is deployed on chain ${chainId}` +
    (environment === 'development' ? ' (development contracts)' : '') +
    '; pass its address as policyAddresses.oneTimeUseId'
  )
}

/**
 * Throws when `policy` is a default deployment with no code on `chainId`. A
 * session resolves its default on its own chain, but an intent can use it on
 * others. Any other address is the caller's to vouch for.
 */
export function assertOneTimeUseIdPolicyDeployed(
  policy: Address,
  chainId: number,
): void {
  const environment = isAddressEqual(policy, ONE_TIME_USE_ID_POLICY_ADDRESS)
    ? 'production'
    : isAddressEqual(policy, ONE_TIME_USE_ID_POLICY_ADDRESS_DEV)
      ? 'development'
      : undefined
  if (environment && !defaultOneTimeUseIdPolicy(chainId, environment)) {
    throw new Error(oneTimeUseIdPolicyMissing(chainId, environment))
  }
}

// CREATE2 deployments of the canonical UniversalActionPolicy bytecode, at the
// same addresses on every chain in UNIVERSAL_ACTION_POLICY_COPY_CHAINS.
export const UNIVERSAL_ACTION_POLICY_COPIES: readonly Address[] = Object.freeze(
  [
    '0x68744D25604872d2F81FAa864963353F3ee9b4d2',
    '0x8a026acb4DF6EFbc9BD4664D1E8750D470E7dD9F',
    '0x6EB915A22F2015A776eec56F11EF96cda1EDCC54',
  ],
)
// Static so the encoding never depends on an RPC read.
export const UNIVERSAL_ACTION_POLICY_COPY_CHAINS: ReadonlySet<number> = new Set(
  [
    1, 10, 56, 100, 130, 137, 143, 146, 196, 480, 999, 1868, 2020, 4663, 5042,
    8453, 9745, 9746, 42161, 57073, 84532, 421614, 747474, 11155111, 11155420,
  ],
)

export interface ResolvedPolicyAddresses {
  readonly sudo: Address
  readonly universalAction: Address
  // Only present when configured or defaulted for a settlement-scoped session.
  readonly universalActionCopies?: readonly Address[]
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
  const resolved: ResolvedPolicyAddresses = {
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
  const copies = overrides?.universalActionCopies ?? []
  if (!copies.length) return resolved
  // A copy receives UniversalActionPolicy initData, so any other policy there
  // would install the rules as something else.
  const others = new Map<string, string>()
  for (const [name, address] of [
    ...Object.entries(DEFAULT_POLICY_ADDRESSES),
    ...Object.entries(resolved),
    ['intent-execution', INTENT_EXECUTION_POLICY_ADDRESS],
    ['intent-execution (dev)', INTENT_EXECUTION_POLICY_ADDRESS_DEV],
    ['Permit2 claim', PERMIT2_CLAIM_POLICY_ADDRESS],
  ] as [string, Address][]) {
    if (name !== 'universalAction') others.set(address.toLowerCase(), name)
  }
  const seen = new Set([resolved.universalAction.toLowerCase()])
  for (const copy of copies) {
    const other = others.get(copy.toLowerCase())
    if (other) {
      throw refusal(
        'UNIVERSAL_ACTION_COPY_INVALID',
        `universalActionCopies: ${copy} is the ${other} policy, not a UniversalActionPolicy deployment`,
      )
    }
    if (seen.has(copy.toLowerCase())) {
      throw refusal(
        'UNIVERSAL_ACTION_COPY_INVALID',
        `universalActionCopies must be distinct from universalAction and from each other; ${copy} repeats`,
      )
    }
    seen.add(copy.toLowerCase())
  }
  return { ...resolved, universalActionCopies: copies }
}
