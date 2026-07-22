import { type Hex, hashTypedData, type TypedDataDefinition } from 'viem'
import { describe, expect, test, vi } from 'vitest'
import { IndependentSigningNotSupportedError } from '../errors/execution'
import type { ResolvedValidatorDefinition } from '../modules/validators/types'
import { encodePlannedValidatorContribution } from './contribution'
import { runSigningStep, SigningPipelineError } from './error'
import { executeSigningPlan } from './execute'
import {
  createSingleStageSigningPlan,
  createValidatorSigningTasks,
  materializeSigningStage,
  signingTopology,
  validateSigningPlan,
} from './plan'
import type { PayloadSigningTask, SigningPlan } from './types'

type DeepMutable<T> = {
  -readonly [Key in keyof T]: DeepMutable<T[Key]>
}

const chain = { kind: 'evm' as const, id: 1, caip2: 'eip155:1' as const }
const payloadId = `0x${'11'.repeat(32)}` as Hex
const signature = `0x${'22'.repeat(65)}` as Hex
const authorizationPayloadId = `0x${'33'.repeat(32)}` as Hex
const typedData: TypedDataDefinition = {
  domain: { name: 'Test', version: '1', chainId: 1 },
  types: { Test: [{ name: 'value', type: 'uint256' }] },
  primaryType: 'Test',
  message: { value: 1n },
}
const topology = {
  rootValidatorId: 'owner',
  validators: [{ id: 'owner', ownerIds: ['a'], threshold: 1 }],
  threshold: 1,
}
const selection = { validatorIds: ['owner'], signerIds: ['a'], threshold: 1 }
const signer = { id: 'a', kind: 'ecdsa' as const }

function task(
  id: string,
  invocationKind: PayloadSigningTask['invocationKind'] = 'ecdsa-sign-message',
): PayloadSigningTask {
  return { id, signer, role: 'owner', invocationKind }
}

function mutablePlan(plan: SigningPlan): DeepMutable<SigningPlan> {
  return plan as DeepMutable<SigningPlan>
}

function directPlan(
  tasks: readonly PayloadSigningTask[],
): DeepMutable<SigningPlan> {
  return mutablePlan(
    createSingleStageSigningPlan({
      kind: 'account-message',
      payload: { kind: 'message', id: payloadId },
      configuredTopology: topology,
      effectiveSelection: selection,
      stageId: 'stage',
      chain,
      tasks,
      artifacts: [],
    }),
  )
}

describe('signing plan materialization and execution', () => {
  test('preserves the independent-signing compatibility error identity', () => {
    const error = new IndependentSigningNotSupportedError()
    expect(error.constructor.name).toBe('IndependentSigningNotSupportedError')
    expect(error.name).toBe('Error')
    expect(error.message).toContain('smart sessions')
  })
  test('executes parallel batches and records typed results', async () => {
    const plan = directPlan([task('a'), task('b')])
    const calls: string[] = []
    const transcript = await executeSigningPlan({
      plan,
      payloads: {
        [payloadId]: { kind: 'message', message: { raw: payloadId } },
      },
      checkpoints: { read: vi.fn() },
      signerInvoker: {
        has: () => true,
        invoke: async (reference) => {
          calls.push(reference.id)
          return { kind: 'ecdsa-signature', signature }
        },
      },
      assembleStage: () => ({}),
    })
    expect(calls).toEqual(['a', 'a'])
    expect(Object.keys(transcript.stages[0].results)).toEqual(['a', 'b'])
  })

  test('materializes every invocation kind without conflating inputs', () => {
    const plan: SigningPlan = {
      ...directPlan([]),
      stages: [
        {
          id: 'stage',
          checkpoint: { kind: 'none', id: 'none' },
          priorOutputs: [],
          taskTemplates: [
            {
              ...task('message'),
              chain,
              payload: { source: 'plan-payload', payloadId },
            },
            {
              ...task('typed', 'ecdsa-sign-typed-data'),
              chain,
              payload: {
                source: 'plan-payload',
                payloadId: hashTypedData(typedData),
              },
            },
            {
              ...task('webauthn-hash', 'webauthn-sign-hash'),
              signer: { id: 'web', kind: 'webauthn' },
              payload: { source: 'plan-payload', payloadId },
            },
            {
              ...task('webauthn-typed', 'webauthn-sign-typed-data'),
              signer: { id: 'web', kind: 'webauthn' },
              payload: {
                source: 'plan-payload',
                payloadId: hashTypedData(typedData),
              },
            },
            {
              ...task('authorization', 'sign-authorization'),
              signer: { id: 'auth', kind: 'wallet-authorization' },
              chain,
              payload: {
                source: 'plan-payload',
                payloadId: authorizationPayloadId,
              },
            },
          ],
          schedule: [],
          artifacts: [],
        },
      ],
    }
    const stage = materializeSigningStage({
      plan,
      stage: plan.stages[0],
      payloads: {
        [payloadId]: { kind: 'message', message: { raw: payloadId } },
        [hashTypedData(typedData)]: { kind: 'typed-data', typedData },
        [authorizationPayloadId]: {
          kind: 'authorization',
          authorization: {
            contractAddress:
              '0x3333333333333333333333333333333333333333' as const,
            chainId: 1,
            nonce: 0,
          },
        },
      },
      facts: [],
      priorOutputs: {},
    })
    expect(stage.tasks.map(({ invocation }) => invocation.kind)).toEqual([
      'ecdsa-sign-message',
      'ecdsa-sign-typed-data',
      'webauthn-sign-hash',
      'webauthn-sign-typed-data',
      'sign-authorization',
    ])
  })

  test('skips an authorization immediately after observing delegation', () => {
    const contract = '0x3333333333333333333333333333333333333333' as const
    const plan = directPlan([])
    const stage = {
      ...plan.stages[0],
      taskTemplates: [
        {
          ...task('auth', 'ecdsa-sign-message'),
          payload: { source: 'plan-payload' as const, payloadId },
          when: {
            kind: 'delegation-required' as const,
            factId: 'code',
            contract,
          },
        },
      ],
      schedule: [
        { id: 'auth', execution: 'serial' as const, taskIds: ['auth'] },
      ],
    }
    const materialized = materializeSigningStage({
      plan,
      stage,
      payloads: {
        [payloadId]: { kind: 'message', message: { raw: payloadId } },
      },
      facts: [
        {
          kind: 'delegation-code',
          id: 'code',
          code: `0xef0100${contract.slice(2)}`,
        },
      ],
      priorOutputs: {},
    })
    expect(materialized.tasks).toEqual([])
    expect(materialized.schedule).toEqual([])
  })

  test('resolves prior artifacts and checkpoint bytes as message inputs', () => {
    const plan = directPlan([])
    const base = {
      ...task('prior'),
      payload: {
        source: 'prior-output' as const,
        stageId: 'one',
        outputId: 'sig',
        selection: 'whole' as const,
      },
    }
    const stage = {
      ...plan.stages[0],
      taskTemplates: [
        base,
        {
          ...task('fact'),
          payload: {
            source: 'checkpoint-fact' as const,
            checkpointId: 'read',
            factId: 'code',
          },
        },
      ],
    }
    const materialized = materializeSigningStage({
      plan,
      stage,
      payloads: {},
      facts: [{ kind: 'delegation-code', id: 'code', code: payloadId }],
      priorOutputs: { 'one:sig': signature },
    })
    expect(materialized.tasks[0].invocation).toMatchObject({
      message: { raw: signature },
    })
    expect(materialized.tasks[1].invocation).toMatchObject({
      message: { raw: payloadId },
    })
  })

  test('adds stable plan, task, and stage diagnostics', async () => {
    const plan = directPlan([task('failure')])
    await expect(
      executeSigningPlan({
        plan,
        payloads: {
          [payloadId]: { kind: 'message', message: { raw: payloadId } },
        },
        checkpoints: { read: vi.fn() },
        signerInvoker: { has: () => false, invoke: vi.fn() },
        assembleStage: () => ({}),
      }),
    ).rejects.toMatchObject({
      name: 'SigningPipelineError',
      context: { failureStage: 'invoke', taskId: 'failure' },
    })

    const error = new Error('wallet rejected')
    await expect(
      executeSigningPlan({
        plan,
        payloads: {
          [payloadId]: { kind: 'message', message: { raw: payloadId } },
        },
        checkpoints: { read: vi.fn() },
        signerInvoker: { invoke: async () => Promise.reject(error) },
        assembleStage: () => ({}),
      }),
    ).rejects.toSatisfy(
      (value: unknown) =>
        value instanceof SigningPipelineError && value.cause === error,
    )
  })

  test('validates plan references, schedules, and ERC-6492 routes', () => {
    const unscheduled = directPlan([task('a')])
    unscheduled.stages[0].schedule[0].taskIds.length = 0
    expect(() => validateSigningPlan(unscheduled)).toThrow('unscheduled')

    const route = createSingleStageSigningPlan({
      kind: 'intent-full',
      payload: { kind: 'intent', id: payloadId },
      configuredTopology: topology,
      effectiveSelection: selection,
      stageId: 'intent',
      tasks: [task('a')],
      artifacts: [
        {
          id: 'sig',
          usage: 'intent-origin',
          validatorCodec: { kind: 'none' },
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'none' },
          erc6492: {
            kind: 'wrap-deployless',
            factory: '0x3333333333333333333333333333333333333333',
            factoryData: '0x',
          },
        },
      ],
    })
    expect(() => validateSigningPlan(route)).toThrow('ERC-6492')

    const duplicateStage = directPlan([])
    duplicateStage.stages.push(duplicateStage.stages[0])
    expect(() => validateSigningPlan(duplicateStage)).toThrow(
      'Duplicate signing stage',
    )

    const unknownTask = directPlan([task('a')])
    unknownTask.stages[0].schedule[0].taskIds[0] = 'missing'
    expect(() => validateSigningPlan(unknownTask)).toThrow('unknown task')

    const duplicateTask = directPlan([task('a'), task('a')])
    expect(() => validateSigningPlan(duplicateTask)).toThrow(
      'Duplicate signing task',
    )

    const duplicateSchedule = directPlan([task('a')])
    duplicateSchedule.stages[0].schedule.push({
      id: 'again',
      execution: 'serial',
      taskIds: ['a'],
    })
    expect(() => validateSigningPlan(duplicateSchedule)).toThrow(
      'scheduled more than once',
    )

    const unknownPublic = directPlan([])
    unknownPublic.publicOutputs.push({
      id: 'unknown',
      source: { kind: 'task-result', taskId: 'unknown' },
      exposedForIndependentSigning: false,
    })
    expect(() => validateSigningPlan(unknownPublic)).toThrow('unknown task')

    const artifactPlan = mutablePlan(
      createSingleStageSigningPlan({
        kind: 'account-message',
        payload: { kind: 'message', id: payloadId },
        configuredTopology: topology,
        effectiveSelection: selection,
        stageId: 'artifact',
        tasks: [],
        artifacts: [
          {
            id: 'sig',
            usage: 'erc1271',
            validatorCodec: { kind: 'none' },
            erc7739: { kind: 'none' },
            accountEnvelope: { kind: 'none' },
            erc6492: { kind: 'none' },
          },
        ],
      }),
    )
    artifactPlan.stages[0].artifacts[0].stageId = 'wrong'
    expect(() => validateSigningPlan(artifactPlan)).toThrow('another stage')

    const unknownArtifact = directPlan([])
    unknownArtifact.publicOutputs.push({
      id: 'missing',
      source: { kind: 'artifact', artifactId: 'missing' },
      exposedForIndependentSigning: false,
    })
    expect(() => validateSigningPlan(unknownArtifact)).toThrow(
      'unknown artifact',
    )
  })

  test('rejects undeclared dependencies and invalid session-state routes', () => {
    const createArtifactPlan = () =>
      mutablePlan(
        createSingleStageSigningPlan({
          kind: 'account-typed-data',
          payload: { kind: 'typed-data', id: payloadId },
          configuredTopology: topology,
          effectiveSelection: selection,
          stageId: 'artifact',
          tasks: [],
          artifacts: [
            {
              id: 'sig',
              usage: 'erc1271',
              validatorCodec: { kind: 'none' },
              erc7739: { kind: 'none' },
              accountEnvelope: { kind: 'none' },
              erc6492: { kind: 'none' },
            },
          ],
        }),
      )

    const unavailable = directPlan([])
    unavailable.stages[0].priorOutputs.push({
      stageId: 'missing-stage',
      outputId: 'missing',
      selection: 'whole',
    })
    expect(() => validateSigningPlan(unavailable)).toThrow('unavailable')

    for (const [payload, message] of [
      [
        {
          source: 'prior-output' as const,
          stageId: 'missing-stage',
          outputId: 'missing',
          selection: 'whole' as const,
        },
        'undeclared prior output',
      ],
      [
        {
          source: 'checkpoint-fact' as const,
          checkpointId: 'missing-read',
          factId: 'missing',
        },
        'undeclared checkpoint',
      ],
    ] as const) {
      const invalid = directPlan([task('dependency')])
      invalid.stages[0].taskTemplates[0].payload = payload
      expect(() => validateSigningPlan(invalid)).toThrow(message)
    }

    const delegation = directPlan([task('delegation')])
    delegation.stages[0].taskTemplates[0].when = {
      kind: 'delegation-required',
      factId: 'missing',
      contract: '0x3333333333333333333333333333333333333333',
    }
    expect(() => validateSigningPlan(delegation)).toThrow(
      'undeclared delegation fact',
    )

    const outsideTask = createArtifactPlan()
    outsideTask.stages[0].artifacts[0].input = {
      kind: 'task-results',
      taskIds: ['missing'],
    }
    expect(() => validateSigningPlan(outsideTask)).toThrow('outside its stage')

    const undeclaredReuse = createArtifactPlan()
    undeclaredReuse.stages[0].artifacts[0].input = {
      kind: 'reuse-artifact',
      stageId: 'missing-stage',
      artifactId: 'missing',
      selection: 'whole',
    }
    expect(() => validateSigningPlan(undeclaredReuse)).toThrow(
      'undeclared prior output',
    )

    const incompletePair = createArtifactPlan()
    incompletePair.stages[0].artifacts[0].input = {
      kind: 'session-claim-pair',
      preClaimArtifactId: 'sig',
      notarizedClaimArtifactId: 'missing',
    }
    expect(() => validateSigningPlan(incompletePair)).toThrow(
      'unavailable component',
    )

    const module = {
      kind: 'validator' as const,
      address: '0x3333333333333333333333333333333333333333' as const,
    }
    const sessionCodec = (mode: 'use' | 'enable-and-use') => ({
      kind: 'smart-session' as const,
      validator: module,
      mode,
      permissionId: payloadId,
      ...(mode === 'enable-and-use' ? { enableData: {} as never } : {}),
    })
    const createSessionPlan = () => {
      const plan = createArtifactPlan()
      plan.stages[0].checkpoint = {
        kind: 'session-enabled',
        id: 'session-enabled',
        chain,
        account: module.address,
        permissionId: payloadId,
      }
      plan.stages[0].artifacts[0].validatorCodec = {
        kind: 'smart-session-state',
        factId: 'session-enabled',
        whenEnabled: sessionCodec('use'),
        whenDisabled: sessionCodec('enable-and-use'),
      }
      return plan
    }
    expect(() => validateSigningPlan(createSessionPlan())).not.toThrow()

    const undeclaredState = createSessionPlan()
    undeclaredState.stages[0].artifacts[0].validatorCodec = {
      ...undeclaredState.stages[0].artifacts[0].validatorCodec,
      factId: 'other',
    } as never
    expect(() => validateSigningPlan(undeclaredState)).toThrow(
      'undeclared session-state fact',
    )

    const changedIdentity = createSessionPlan()
    const changedCodec = changedIdentity.stages[0].artifacts[0]
      .validatorCodec as Extract<
      (typeof changedIdentity.stages)[number]['artifacts'][number]['validatorCodec'],
      { kind: 'smart-session-state' }
    >
    changedIdentity.stages[0].artifacts[0].validatorCodec = {
      ...changedCodec,
      whenDisabled: {
        ...changedCodec.whenDisabled,
        permissionId: `0x${'44'.repeat(32)}`,
      },
    }
    expect(() => validateSigningPlan(changedIdentity)).toThrow(
      'changes Smart Session identity',
    )

    const invalidState = createSessionPlan()
    const invalidCodec = invalidState.stages[0].artifacts[0]
      .validatorCodec as typeof changedCodec
    invalidState.stages[0].artifacts[0].validatorCodec = {
      ...invalidCodec,
      whenDisabled: { ...invalidCodec.whenDisabled, mode: 'use' },
    }
    expect(() => validateSigningPlan(invalidState)).toThrow(
      'invalid Smart Session state route',
    )

    const missingEnableData = createArtifactPlan()
    missingEnableData.stages[0].artifacts[0].validatorCodec = {
      ...sessionCodec('enable-and-use'),
      enableData: undefined,
    }
    expect(() => validateSigningPlan(missingEnableData)).toThrow(
      'no Smart Session enable data',
    )
  })

  test('preserves an existing signing diagnostic without wrapping it twice', () => {
    const cause = new SigningPipelineError('existing', {
      planKind: 'account-message',
      payloadKind: 'message',
      failureStage: 'validator-encode',
    })
    expect(() =>
      runSigningStep({
        plan: directPlan([]),
        failureStage: 'final-assembly',
        stageId: 'stage',
        artifactId: 'artifact',
        usage: 'erc1271',
        operation: () => {
          throw cause
        },
      }),
    ).toThrow(cause)
  })

  test('rejects incompatible task material and conditional facts', () => {
    const plan = directPlan([])
    const stage = {
      ...plan.stages[0],
      taskTemplates: [
        {
          ...task('typed', 'ecdsa-sign-typed-data'),
          payload: { source: 'plan-payload' as const, payloadId },
        },
      ],
    }
    expect(() =>
      materializeSigningStage({
        plan,
        stage,
        payloads: {
          [payloadId]: { kind: 'message', message: { raw: payloadId } },
        },
        facts: [],
        priorOutputs: {},
      }),
    ).toThrow('requires typed-data')
    expect(() =>
      materializeSigningStage({
        plan,
        stage,
        payloads: {},
        facts: [],
        priorOutputs: {},
      }),
    ).toThrow('No payload material')

    const conditional = {
      ...stage,
      taskTemplates: [
        {
          ...task('conditional'),
          payload: { source: 'plan-payload' as const, payloadId },
          when: {
            kind: 'delegation-required' as const,
            factId: 'missing',
            contract: '0x3333333333333333333333333333333333333333' as const,
          },
        },
      ],
    }
    expect(() =>
      materializeSigningStage({
        plan,
        stage: conditional,
        payloads: {
          [payloadId]: { kind: 'message', message: { raw: payloadId } },
        },
        facts: [],
        priorOutputs: {},
      }),
    ).toThrow('Delegation fact')

    expect(() =>
      materializeSigningStage({
        plan,
        stage: {
          ...stage,
          taskTemplates: [
            {
              ...task('authorization', 'sign-authorization'),
              payload: { source: 'plan-payload', payloadId },
            },
          ],
        },
        payloads: {
          [payloadId]: {
            kind: 'authorization',
            authorization: {
              contractAddress: '0x3333333333333333333333333333333333333333',
              chainId: 1,
              nonce: 0,
            },
          },
        },
        facts: [],
        priorOutputs: {},
      }),
    ).toThrow('has no chain')

    const priorStage = {
      ...stage,
      taskTemplates: [
        {
          ...task('prior'),
          payload: {
            source: 'prior-output' as const,
            stageId: 'one',
            outputId: 'structured',
            selection: 'whole' as const,
          },
        },
      ],
    }
    expect(() =>
      materializeSigningStage({
        plan,
        stage: priorStage,
        payloads: {},
        facts: [],
        priorOutputs: {
          'one:structured': {
            preClaimSig: '0x12',
            notarizedClaimSig: '0x34',
          },
        },
      }),
    ).toThrow('not signable bytes')
    expect(
      materializeSigningStage({
        plan,
        stage: {
          ...priorStage,
          taskTemplates: [
            {
              ...priorStage.taskTemplates[0],
              payload: {
                source: 'prior-output',
                stageId: 'one',
                outputId: 'structured',
                selection: 'pre-claim',
              },
            },
          ],
        },
        payloads: {},
        facts: [],
        priorOutputs: {
          'one:structured': {
            preClaimSig: '0x12',
            notarizedClaimSig: '0x34',
          },
        },
      }).tasks[0].invocation,
    ).toMatchObject({ message: { raw: '0x12' } })
    expect(() =>
      materializeSigningStage({
        plan,
        stage: {
          ...stage,
          taskTemplates: [
            {
              ...task('fact'),
              payload: {
                source: 'checkpoint-fact',
                checkpointId: 'read',
                factId: 'missing',
              },
            },
          ],
        },
        payloads: {},
        facts: [],
        priorOutputs: {},
      }),
    ).toThrow('not signable bytes')
  })

  test('derives inspectable tasks and topology from validator definitions', () => {
    const account = {
      address: '0x3333333333333333333333333333333333333333',
    } as never
    const validator: ResolvedValidatorDefinition = {
      kind: 'ecdsa',
      id: 'owner',
      publicId: 0,
      module: { source: 'default', profile: 'ownable' },
      owners: [{ kind: 'ecdsa', id: 'owner/a', signerId: 'ecdsa:a', account }],
      threshold: 1,
    }
    expect(
      createValidatorSigningTasks({
        validator,
        signerReferences: { 'ecdsa:a': signer },
        taskPrefix: 'message',
        ecdsaInvocation: 'ecdsa-sign-message',
        webauthnInvocation: 'webauthn-sign-hash',
      }),
    ).toMatchObject([
      { id: 'message:owner/a', contribution: { ownerId: 'owner/a' } },
    ])
    expect(signingTopology(validator)).toEqual({
      configuredTopology: {
        rootValidatorId: 'owner',
        validators: [{ id: 'owner', ownerIds: ['owner/a'], threshold: 1 }],
        threshold: 1,
      },
      effectiveSelection: {
        validatorIds: ['owner'],
        signerIds: ['ecdsa:a'],
        threshold: 1,
      },
    })

    const webauthnAccount = {
      type: 'webAuthn',
      publicKey: `0x04${'11'.repeat(64)}`,
    } as never
    const nested: ResolvedValidatorDefinition = {
      kind: 'multi-factor',
      id: 'mfa',
      publicId: 0,
      module: { source: 'default', profile: 'multi-factor' },
      validators: [
        validator,
        {
          kind: 'passkey',
          id: 'passkey-factor',
          publicId: 1,
          module: { source: 'default', profile: 'webauthn' },
          owners: [
            {
              kind: 'webauthn',
              id: 'passkey/a',
              signerId: 'webauthn:a',
              account: webauthnAccount,
            },
          ],
          threshold: 1,
        },
      ],
      threshold: 2,
    }
    expect(
      createValidatorSigningTasks({
        validator: nested,
        signerReferences: {
          'ecdsa:a': signer,
          'webauthn:a': { id: 'passkey', kind: 'webauthn' },
        },
        taskPrefix: 'intent',
        ecdsaInvocation: 'ecdsa-sign-typed-data',
        webauthnInvocation: 'webauthn-sign-typed-data',
        role: 'factor',
      }).map(({ contribution }) => contribution?.kind),
    ).toEqual(['ecdsa', 'webauthn'])
    expect(
      createValidatorSigningTasks({
        validator: {
          ...nested,
          validators: [nested.validators[1], nested.validators[0]],
        },
        signerReferences: {
          'ecdsa:a': signer,
          'webauthn:a': { id: 'passkey', kind: 'webauthn' },
        },
        taskPrefix: 'intent',
        ecdsaInvocation: 'ecdsa-sign-typed-data',
        webauthnInvocation: 'webauthn-sign-typed-data',
        role: 'factor',
      }).map(({ contribution }) => contribution?.kind),
    ).toEqual(['ecdsa', 'webauthn'])
    expect(signingTopology(nested).configuredTopology.validators).toHaveLength(
      2,
    )
    expect(() =>
      createValidatorSigningTasks({
        validator,
        signerReferences: {},
        taskPrefix: 'missing',
        ecdsaInvocation: 'ecdsa-sign-message',
        webauthnInvocation: 'webauthn-sign-hash',
      }),
    ).toThrow('missing')
  })

  test('rejects incomplete or incompatible planned contributions', () => {
    const artifact = {
      id: 'signature',
      stageId: 'stage',
      usage: 'erc1271' as const,
      input: { kind: 'task-results' as const, taskIds: ['owner'] },
      validatorCodec: {
        kind: 'ordered-threshold' as const,
        validator: {
          kind: 'validator' as const,
          address: '0x3333333333333333333333333333333333333333' as const,
        },
        ownerOrder: ['owner'],
        threshold: 1,
        recoveryEncoding: 'ethereum' as const,
      },
      erc7739: { kind: 'none' as const },
      accountEnvelope: { kind: 'none' as const },
      erc6492: { kind: 'none' as const },
    }
    const stage = {
      stageId: 'stage',
      facts: [],
      schedule: [],
      tasks: [
        {
          ...task('owner'),
          payload: { source: 'plan-payload' as const, payloadId },
          contribution: {
            kind: 'ecdsa' as const,
            ownerId: 'owner',
            encoding: 'raw-signer' as const,
          },
          invocation: {
            kind: 'ecdsa-sign-message' as const,
            message: { raw: payloadId },
          },
        },
      ],
    }
    expect(() =>
      encodePlannedValidatorContribution({
        artifact: { ...artifact, validatorCodec: { kind: 'none' } },
        stage,
        results: {},
      }),
    ).toThrow('no validator')
    expect(() =>
      encodePlannedValidatorContribution({
        artifact: {
          ...artifact,
          input: {
            kind: 'reuse-artifact',
            stageId: 'prior',
            artifactId: 'prior',
            selection: 'whole',
          },
        },
        stage,
        results: {},
      }),
    ).toThrow('does not use task results')
    expect(() =>
      encodePlannedValidatorContribution({ artifact, stage, results: {} }),
    ).toThrow('incomplete')
    expect(() =>
      encodePlannedValidatorContribution({
        artifact,
        stage,
        results: {
          owner: {
            kind: 'webauthn-assertion',
            signature: '0x',
            authenticatorData: '0x',
            clientDataJSON: '{}',
            challengeIndex: 0,
            typeIndex: 0,
            userVerificationRequired: false,
          },
        },
      }),
    ).toThrow('ECDSA task')
    for (const [metadata, expected] of [
      [
        {
          kind: 'webauthn' as const,
          ownerId: 'owner',
          publicKey: `0x${'11'.repeat(64)}` as Hex,
        },
        'WebAuthn task',
      ],
      [{ kind: 'authorization' as const }, 'Authorization results'],
    ] as const) {
      expect(() =>
        encodePlannedValidatorContribution({
          artifact,
          stage: {
            ...stage,
            tasks: [{ ...stage.tasks[0], contribution: metadata }],
          },
          results: {
            owner: { kind: 'ecdsa-signature', signature },
          },
        }),
      ).toThrow(expected)
    }
    expect(() =>
      encodePlannedValidatorContribution({
        artifact,
        stage: {
          ...stage,
          tasks: [
            {
              ...stage.tasks[0],
              contribution: {
                kind: 'session',
                recoveryEncoding: 'ethereum',
              },
            },
          ],
        },
        results: {
          owner: {
            kind: 'webauthn-assertion',
            signature: '0x',
            authenticatorData: '0x',
            clientDataJSON: '{}',
            challengeIndex: 0,
            typeIndex: 0,
            userVerificationRequired: false,
          },
        },
      }),
    ).toThrow('Session task')
    expect(() =>
      encodePlannedValidatorContribution({
        artifact: {
          ...artifact,
          validatorCodec: {
            kind: 'smart-session-state',
            factId: 'enabled',
            whenEnabled: {
              kind: 'smart-session',
              validator: artifact.validatorCodec.validator,
              mode: 'use',
              permissionId: payloadId,
            },
            whenDisabled: {
              kind: 'smart-session',
              validator: artifact.validatorCodec.validator,
              mode: 'enable-and-use',
              permissionId: payloadId,
            },
          },
        },
        stage,
        results: { owner: { kind: 'ecdsa-signature', signature } },
      }),
    ).toThrow('Session-state fact')
  })

  test('encodes session signer recovery for the owning validator', () => {
    const sessionSignature = `0x${'22'.repeat(64)}1b` as Hex
    const validator = {
      kind: 'validator' as const,
      address: '0x3333333333333333333333333333333333333333' as const,
    }
    const artifact = {
      id: 'signature',
      stageId: 'stage',
      usage: 'intent-pre-claim' as const,
      input: { kind: 'task-results' as const, taskIds: ['owner'] },
      validatorCodec: {
        kind: 'smart-session' as const,
        validator,
        mode: 'pre-claim' as const,
        permissionId: payloadId,
      },
      erc7739: { kind: 'none' as const },
      accountEnvelope: { kind: 'none' as const },
      erc6492: { kind: 'none' as const },
    }
    const stage = {
      stageId: 'stage',
      facts: [],
      schedule: [],
      tasks: [
        {
          ...task('owner'),
          payload: { source: 'plan-payload' as const, payloadId },
          contribution: {
            kind: 'session' as const,
            recoveryEncoding: 'validator-offset-4' as const,
          },
          invocation: {
            kind: 'ecdsa-sign-message' as const,
            message: { raw: payloadId },
          },
        },
      ],
    }

    expect(
      encodePlannedValidatorContribution({
        artifact,
        stage,
        results: {
          owner: { kind: 'ecdsa-signature', signature: sessionSignature },
        },
      }).endsWith('1f'),
    ).toBe(true)
  })
})
