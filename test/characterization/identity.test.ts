import { describe, expect, test } from 'vitest'
import {
  createDeterministicOwner,
  getComparisonGroupNamespace,
  getIdentityNamespace,
} from './identity'

const common = {
  baseSha: '49efb8b8d957b2eea2b24c11ac56d6c4d80478d6',
  runId: 'calibration-1',
}

describe('characterization identity isolation', () => {
  test('shares non-mutating identities across subjects and runs', () => {
    const scenario = {
      id: 'signing/safe',
      comparison: 'shared-inputs',
    } as const
    const legacy = getIdentityNamespace({
      ...common,
      scenario,
      subject: 'legacy',
    })
    const rewrite = getIdentityNamespace({
      ...common,
      scenario,
      subject: 'rewrite',
    })

    expect(legacy).toBe(rewrite)
    expect(
      getIdentityNamespace({
        ...common,
        runId: 'calibration-2',
        scenario,
        subject: 'legacy',
      }),
    ).toBe(legacy)
  })

  test('isolates stateful identities while retaining one comparison group', () => {
    const scenario = {
      id: 'intent/safe/execute',
      comparison: 'isolated-state',
    } as const
    const group = getComparisonGroupNamespace({
      ...common,
      scenario,
      subject: 'legacy',
    })
    const legacy = getIdentityNamespace({
      ...common,
      scenario,
      subject: 'legacy',
    })
    const rewrite = getIdentityNamespace({
      ...common,
      scenario,
      subject: 'rewrite',
    })

    expect(legacy).toBe(`${group}:legacy`)
    expect(rewrite).toBe(`${group}:rewrite`)
  })

  test('derives stable distinct owner addresses without exposing key material', () => {
    const namespace = 'sdk-characterization:test'

    expect(createDeterministicOwner(namespace, 'owner').address).toBe(
      createDeterministicOwner(namespace, 'owner').address,
    )
    expect(createDeterministicOwner(namespace, 'owner').address).not.toBe(
      createDeterministicOwner(namespace, 'session').address,
    )
  })
})
