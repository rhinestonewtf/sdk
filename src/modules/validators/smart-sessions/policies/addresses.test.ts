import { describe, expect, test } from 'vitest'
import {
  assertOneTimeUseIdPolicyDeployed,
  defaultOneTimeUseIdPolicy,
  defaultPermit2SenderPolicy,
  ONE_TIME_USE_ID_POLICY_ADDRESS,
  ONE_TIME_USE_ID_POLICY_ADDRESS_DEV,
  PERMIT2_SENDER_POLICY_ADDRESS,
  resolvePolicyAddresses,
  timeFramePolicyDeployed,
} from './addresses'

const CUSTOM = '0x1111111111111111111111111111111111111111' as const

describe('policy deployment boundaries', () => {
  test.each(['production', 'development'] as const)(
    'default once policy rejects unsupported chains (%s)',
    (environment) => {
      const policy =
        environment === 'production'
          ? ONE_TIME_USE_ID_POLICY_ADDRESS
          : ONE_TIME_USE_ID_POLICY_ADDRESS_DEV
      expect(defaultOneTimeUseIdPolicy(8453, environment)).toBe(policy)
      expect(defaultOneTimeUseIdPolicy(424242, environment)).toBeUndefined()
      expect(() => assertOneTimeUseIdPolicyDeployed(policy, 8453)).not.toThrow()
      expect(() => assertOneTimeUseIdPolicyDeployed(policy, 424242)).toThrow(
        /no OneTimeUseIdPolicy is deployed/,
      )
    },
  )

  test('caller-pinned policies are not treated as default deployments', () => {
    expect(() => assertOneTimeUseIdPolicyDeployed(CUSTOM, 424242)).not.toThrow()
    expect(defaultPermit2SenderPolicy(8453)).toBe(PERMIT2_SENDER_POLICY_ADDRESS)
    expect(defaultPermit2SenderPolicy(424242)).toBeUndefined()
    expect(timeFramePolicyDeployed(8453)).toBe(true)
    expect(timeFramePolicyDeployed(424242)).toBe(false)
  })

  test('every explicit override survives resolution without a deployment lookup', () => {
    const overrides = {
      sudo: CUSTOM,
      universalAction: CUSTOM,
      argPolicy: CUSTOM,
      spendingLimits: CUSTOM,
      timeFrame: CUSTOM,
      usageLimit: CUSTOM,
      valueLimit: CUSTOM,
      oneTimeUseId: CUSTOM,
    }
    expect(
      resolvePolicyAddresses(overrides, {
        chainId: 424242,
        environment: 'development',
      }),
    ).toEqual(overrides)
  })
})
