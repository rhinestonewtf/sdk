import { concat } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  assembleDualSessionIntentFixture,
  assembleIndependentMfaFixture,
  dualSessionPlan,
  dualSessionTranscript,
  independentMfaPlan,
  independentMfaTranscript,
} from './plan-contract.fixtures'

describe('dual-session signing contract', () => {
  test('keeps notarized and pre-claim invocations distinct', () => {
    const tasks = dualSessionTranscript.stages[0].stage.tasks

    expect(tasks).toHaveLength(2)
    expect(tasks.map(({ invocation }) => invocation.kind)).toEqual([
      'ecdsa-sign-message',
      'ecdsa-sign-typed-data',
    ])
    expect(tasks[0].payload).not.toEqual(tasks[1].payload)
  })

  test('reuses only the assembled pre-claim artifact', () => {
    const assembled = assembleDualSessionIntentFixture(dualSessionTranscript)
    const destination = dualSessionPlan.stages[1].artifacts[0]
    const target = dualSessionPlan.stages[2].artifacts[0]

    expect(destination.input).toEqual({
      kind: 'reuse-artifact',
      stageId: 'origin-base',
      artifactId: 'origin-pre-claim',
      selection: 'pre-claim',
    })
    expect(target.input).toEqual(destination.input)
    expect(assembled.destination).toBe(assembled.origin.preClaim)
    expect(assembled.target).toBe(assembled.origin.preClaim)
    expect(assembled.target).not.toBe(assembled.origin.notarized)
  })

  test('declares reads in origin, destination, then target order', () => {
    expect(
      dualSessionPlan.stages.map(({ id, checkpoint }) => [id, checkpoint.kind]),
    ).toEqual([
      ['origin-base', 'session-enabled'],
      ['destination-arbitrum', 'session-enabled'],
      ['target-arbitrum', 'session-enabled'],
    ])
  })
})

describe('independent MFA signing contract', () => {
  test('exposes owner results and assembles factors in configured order', () => {
    const assembled = assembleIndependentMfaFixture(independentMfaTranscript)
    const results = independentMfaTranscript.stages[0].results
    const ownerA = results['owner-a-task']
    const ownerB = results['owner-b-task']
    const passkey = results['passkey-a-task']

    if (
      ownerA.kind !== 'ecdsa-signature' ||
      ownerB.kind !== 'ecdsa-signature' ||
      passkey.kind !== 'webauthn-assertion'
    ) {
      throw new Error(
        'Independent-MFA fixture contains unexpected result kinds',
      )
    }

    expect(
      independentMfaPlan.publicOutputs.map(({ source }) => source.kind),
    ).toEqual(['task-result', 'task-result', 'task-result'])
    expect(assembled.factors.map(({ validatorId }) => validatorId)).toEqual([
      'ownable-factor',
      'passkey-factor',
    ])
    expect(assembled.signature).toBe(
      concat([ownerA.signature, ownerB.signature, passkey.signature]),
    )
  })

  test('schedules independent factor prompts as an explicit parallel batch', () => {
    expect(independentMfaPlan.stages[0].schedule).toEqual([
      {
        id: 'mfa-factor-prompts',
        execution: 'parallel',
        taskIds: ['owner-a-task', 'owner-b-task', 'passkey-a-task'],
      },
    ])
  })
})
