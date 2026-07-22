import { concat, type Hex, hashTypedData, type TypedDataDefinition } from 'viem'
import { describe, expect, test, vi } from 'vitest'
import type { AccountAdapter } from '../../accounts/adapter'
import {
  InsufficientOwnerSignaturesError,
  MismatchedOwnerSignaturesError,
  UnknownOwnerError,
} from '../../errors/execution'
import type { SigningContext } from '../context'
import {
  assembleIntentStage,
  assembleIntentValidatorArtifact,
} from './assemble'
import { assembleIndependentIntentArtifact } from './independent'
import {
  createIntentSigningPlan,
  executeIntentSigning,
  projectIndependentSigning,
} from './plan'
import type {
  IntentSigningInput,
  IntentSigningPlanCreationInput,
} from './types'

const chain = { kind: 'evm' as const, id: 1, caip2: 'eip155:1' as const }
const destinationChain = {
  kind: 'evm' as const,
  id: 10,
  caip2: 'eip155:10' as const,
}
const account = '0x1111111111111111111111111111111111111111'
const owner = '0x2222222222222222222222222222222222222222'
const validator = '0x3333333333333333333333333333333333333333'
const intentId = `0x${'44'.repeat(32)}` as Hex
const rawSignature = `0x${'55'.repeat(64)}1b` as Hex
const typedData = (id: number): TypedDataDefinition => ({
  domain: {
    name: 'Intent',
    version: '1',
    chainId: id,
    verifyingContract: account,
  },
  types: { Intent: [{ name: 'value', type: 'uint256' }] },
  primaryType: 'Intent',
  message: { value: BigInt(id) },
})
const topology = {
  rootValidatorId: 'owner-validator',
  validators: [{ id: 'owner-validator', ownerIds: ['owner/a'], threshold: 1 }],
  threshold: 1,
}
const selection = {
  validatorIds: ['owner-validator'],
  signerIds: ['owner'],
  threshold: 1,
}
const codec = {
  kind: 'ordered-threshold' as const,
  validator: { kind: 'validator' as const, address: validator },
  ownerOrder: ['owner/a'],
  threshold: 1,
  recoveryEncoding: 'validator-offset-4' as const,
}

function context(
  invoke: SigningContext['signerInvoker']['invoke'] = async () => ({
    kind: 'ecdsa-signature',
    signature: rawSignature,
  }),
): SigningContext {
  return {
    account: { definition: { kind: 'eoa' }, address: account },
    accountAdapter: {
      encodeSignatureEnvelope: ({ validatorContribution }) =>
        concat(['0xaa', validatorContribution]),
    } as unknown as AccountAdapter,
    accountCapabilities: {
      modular: true,
      supportsDeployment: true,
      supportsUserOperations: true,
      supportsEip7702Adoption: false,
      supportsSmartSessions: true,
      supportsOriginSignatureReuse: true,
      signatureEnvelope: { kind: 'nexus', validator },
    },
    validator: {
      kind: 'ecdsa',
      id: 'owner-validator',
      publicId: 0,
      module: { source: 'explicit', address: validator },
      owners: [],
      threshold: 1,
    },
    validatorCapabilities: {
      compatibilityKey: {
        validatorKind: 'ecdsa',
        moduleAddress: validator,
        accountProfile: 'test',
        purpose: 'intent',
      },
      payloadKinds: ['intent'],
      signatureModes: ['owner'],
      signerTopology: 'single',
      supportsIndependentSigning: true,
      supportsOriginReuse: true,
      supportsMockSignature: true,
      supportsEip712: true,
      recoveryEncoding: 'validator-offset-4',
      contributionCodec: codec,
    },
    effectiveSigners: selection,
    signerReferences: { owner: { id: 'owner', kind: 'ecdsa' } },
    signerInvoker: { has: () => true, invoke },
  }
}

function ownerIntent(): IntentSigningInput {
  const data = typedData(chain.id)
  return {
    id: intentId,
    preparedSignatureMode: 'default',
    configuredTopology: topology,
    effectiveSelection: selection,
    origins: [
      {
        id: hashTypedData(data),
        chain,
        role: 'origin',
        typedData: data,
        usage: 'intent-origin',
      },
    ],
    destination: {
      mode: 'reuse-origin',
      artifactId: 'destination',
      originArtifactId: 'origin',
      selection: 'whole',
    },
    artifacts: [
      {
        id: 'origin',
        usage: 'intent-origin',
        payloadId: hashTypedData(data),
        cardinality: 'per-origin',
        shape: 'hex',
        exposedForIndependentSigning: true,
      },
      {
        id: 'destination',
        usage: 'intent-destination',
        payloadId: hashTypedData(data),
        cardinality: 'one',
        shape: 'hex',
        exposedForIndependentSigning: false,
      },
    ],
  }
}

function ownerPlanInput(): IntentSigningPlanCreationInput {
  const intent = ownerIntent()
  const payloadId = intent.origins[0].id
  return {
    intent,
    payloads: {
      [payloadId]: {
        kind: 'typed-data',
        typedData: intent.origins[0].typedData,
      },
    },
    stages: [
      {
        id: 'origin',
        checkpoint: { kind: 'none', id: 'origin-no-read' },
        priorOutputs: [],
        tasks: [
          {
            id: 'origin-owner',
            signer: { id: 'owner', kind: 'ecdsa' },
            role: 'owner',
            chain,
            invocationKind: 'ecdsa-sign-typed-data',
            payload: { source: 'plan-payload', payloadId },
            contribution: {
              kind: 'ecdsa',
              ownerId: 'owner/a',
              encoding: 'raw-signer',
            },
          },
        ],
        schedule: [
          {
            id: 'origin-prompt',
            execution: 'parallel',
            taskIds: ['origin-owner'],
          },
        ],
        artifacts: [
          {
            id: 'origin',
            usage: 'intent-origin',
            input: { kind: 'task-results', taskIds: ['origin-owner'] },
            validatorCodec: codec,
            erc7739: { kind: 'none' },
            accountEnvelope: { kind: 'nexus', validator },
            erc6492: { kind: 'none' },
          },
        ],
      },
      {
        id: 'destination',
        checkpoint: { kind: 'none', id: 'destination-no-read' },
        priorOutputs: [
          { stageId: 'origin', outputId: 'origin', selection: 'whole' },
        ],
        tasks: [],
        schedule: [],
        artifacts: [
          {
            id: 'destination',
            usage: 'intent-destination',
            input: {
              kind: 'reuse-artifact',
              stageId: 'origin',
              artifactId: 'origin',
              selection: 'whole',
            },
            validatorCodec: { kind: 'none' },
            erc7739: { kind: 'none' },
            accountEnvelope: { kind: 'none' },
            erc6492: { kind: 'none' },
          },
        ],
      },
    ],
  }
}

describe('intent signing plans', () => {
  test('full and imported ECDSA contributions converge byte-for-byte', async () => {
    const planInput = ownerPlanInput()
    const signingContext = context()
    const full = await executeIntentSigning({
      planInput,
      context: signingContext,
      checkpoints: { read: vi.fn() },
    })
    const fullSignature = full.stages[0].outputs.origin
    expect(full.stages[1].outputs.destination).toBe(fullSignature)

    const artifact = createIntentSigningPlan(planInput).stages[0].artifacts[0]
    const independent = assembleIndependentIntentArtifact({
      intentId,
      originIndex: 0,
      originCount: 1,
      signatures: [
        {
          intentId,
          kind: 'ecdsa',
          signer: owner,
          origin: [`0x${'55'.repeat(64)}1f`],
        },
      ],
      owners: [{ ownerId: 'owner/a', identity: owner, kind: 'ecdsa' }],
      artifact,
      context: signingContext,
    })
    expect(independent).toBe(fullSignature)
  })

  test('full and imported MFA contributions converge across ECDSA and passkeys', async () => {
    const data = typedData(chain.id)
    const payloadId = hashTypedData(data)
    const passkey = `0x04${'66'.repeat(32)}${'77'.repeat(32)}` as Hex
    const passkeySignature = `0x${'88'.repeat(64)}` as Hex
    const assertion = {
      signature: passkeySignature,
      authenticatorData: `0x${'99'.repeat(37)}` as Hex,
      clientDataJSON: '{}',
      challengeIndex: 0,
      typeIndex: 1,
      userVerificationRequired: false,
    }
    const nestedCodec = {
      kind: 'nested-threshold' as const,
      validator: { kind: 'validator' as const, address: validator },
      factorOrder: ['ecdsa-factor', 'passkey-factor'],
      threshold: 2,
    }
    const factors = [
      {
        id: 'ecdsa-factor',
        publicId: 1,
        validator: '0x4444444444444444444444444444444444444444' as const,
        codec: {
          ...codec,
          validator: {
            kind: 'validator' as const,
            address: '0x4444444444444444444444444444444444444444' as const,
          },
        },
      },
      {
        id: 'passkey-factor',
        publicId: '0x02' as Hex,
        validator: '0x5555555555555555555555555555555555555555' as const,
        codec: {
          kind: 'ordered-threshold' as const,
          validator: {
            kind: 'validator' as const,
            address: '0x5555555555555555555555555555555555555555' as const,
          },
          ownerOrder: ['passkey/a'],
          threshold: 1,
          recoveryEncoding: 'ethereum' as const,
          webauthn: {
            account,
            usePrecompile: false,
            format: 'current' as const,
          },
        },
      },
    ]
    const intent: IntentSigningInput = {
      id: intentId,
      preparedSignatureMode: 'default',
      configuredTopology: {
        rootValidatorId: 'mfa',
        validators: [
          { id: 'ecdsa-factor', ownerIds: ['owner/a'], threshold: 1 },
          { id: 'passkey-factor', ownerIds: ['passkey/a'], threshold: 1 },
        ],
        threshold: 2,
      },
      effectiveSelection: {
        validatorIds: ['ecdsa-factor', 'passkey-factor'],
        signerIds: ['owner', 'passkey'],
        threshold: 2,
      },
      origins: [
        {
          id: payloadId,
          chain,
          role: 'origin',
          typedData: data,
          usage: 'intent-origin',
        },
      ],
      artifacts: [
        {
          id: 'origin',
          usage: 'intent-origin',
          payloadId,
          cardinality: 'per-origin',
          shape: 'hex',
          exposedForIndependentSigning: true,
        },
      ],
    }
    const planInput: IntentSigningPlanCreationInput = {
      intent,
      payloads: { [payloadId]: { kind: 'typed-data', typedData: data } },
      stages: [
        {
          id: 'origin',
          checkpoint: { kind: 'none', id: 'none' },
          priorOutputs: [],
          tasks: [
            {
              id: 'ecdsa',
              signer: { id: 'owner', kind: 'ecdsa' },
              role: 'factor',
              chain,
              invocationKind: 'ecdsa-sign-typed-data',
              payload: { source: 'plan-payload', payloadId },
              contribution: {
                kind: 'ecdsa',
                ownerId: 'owner/a',
                factorId: 'ecdsa-factor',
                encoding: 'raw-signer',
              },
            },
            {
              id: 'passkey',
              signer: { id: 'passkey', kind: 'webauthn' },
              role: 'factor',
              chain,
              invocationKind: 'webauthn-sign-typed-data',
              payload: { source: 'plan-payload', payloadId },
              contribution: {
                kind: 'webauthn',
                ownerId: 'passkey/a',
                publicKey: passkey,
                factorId: 'passkey-factor',
              },
            },
          ],
          schedule: [
            {
              id: 'factors',
              execution: 'parallel',
              taskIds: ['ecdsa', 'passkey'],
            },
          ],
          artifacts: [
            {
              id: 'origin',
              usage: 'intent-origin',
              input: { kind: 'task-results', taskIds: ['ecdsa', 'passkey'] },
              validatorCodec: nestedCodec,
              validatorFactors: factors,
              erc7739: { kind: 'none' },
              accountEnvelope: { kind: 'nexus', validator },
              erc6492: { kind: 'none' },
            },
          ],
        },
      ],
    }
    const signingContext = context(async (reference) =>
      reference.kind === 'webauthn'
        ? { kind: 'webauthn-assertion', ...assertion }
        : { kind: 'ecdsa-signature', signature: rawSignature },
    )
    const full = await executeIntentSigning({
      planInput,
      context: signingContext,
      checkpoints: { read: vi.fn() },
    })
    const artifact = createIntentSigningPlan(planInput).stages[0].artifacts[0]
    const independent = assembleIndependentIntentArtifact({
      intentId,
      originIndex: 0,
      originCount: 1,
      signatures: [
        {
          intentId,
          kind: 'multi-factor',
          validatorId: 1,
          signature: {
            kind: 'ecdsa',
            signer: owner,
            origin: [`0x${'55'.repeat(64)}1f`],
          },
        },
        {
          intentId,
          kind: 'multi-factor',
          validatorId: '0x02',
          signature: {
            kind: 'passkey',
            publicKey: passkey,
            origin: [{ webauthn: assertion, signature: passkeySignature }],
          },
        },
      ],
      owners: [
        {
          ownerId: 'owner/a',
          identity: owner,
          kind: 'ecdsa',
          factorId: 'ecdsa-factor',
          factorPublicId: 1,
        },
        {
          ownerId: 'passkey/a',
          identity: passkey,
          kind: 'webauthn',
          factorId: 'passkey-factor',
          factorPublicId: '0x02',
        },
      ],
      artifact,
      context: signingContext,
    })
    expect(independent).toBe(full.stages[0].outputs.origin)
  })

  test('projects atomic owner tasks without cloning assembly byte logic', () => {
    const plan = createIntentSigningPlan(ownerPlanInput())
    expect(plan.preparedIntent).toMatchObject({
      signatureMode: 'default',
      destination: {
        mode: 'reuse-origin',
        artifactId: 'destination',
      },
    })
    const projected = projectIndependentSigning(plan, ['owner'])
    expect(projected.plan.kind).toBe('intent-independent')
    expect(projected.plan.stages[0].artifacts).toEqual([])
    expect(projected.plan.publicOutputs).toEqual([
      {
        id: 'origin-owner-contribution',
        source: { kind: 'task-result', taskId: 'origin-owner' },
        exposedForIndependentSigning: true,
      },
    ])
    expect(() => projectIndependentSigning(plan, ['owner', 'owner'])).toThrow(
      'duplicates',
    )
    expect(() => projectIndependentSigning(plan, ['unknown'])).toThrow(
      'not in the plan',
    )
  })

  test('assembles direct EOA, ERC-7739, and structured reuse routes explicitly', () => {
    const signingContext = context()
    const baseArtifact = createIntentSigningPlan(ownerPlanInput()).stages[0]
      .artifacts[0]
    expect(
      assembleIntentValidatorArtifact({
        artifact: {
          ...baseArtifact,
          erc7739: { kind: 'wrap-typed-data', typedData: typedData(1) },
          accountEnvelope: { kind: 'none' },
        },
        context: signingContext,
        validatorContribution: rawSignature,
      }),
    ).not.toBe(rawSignature)
    expect(() =>
      assembleIntentValidatorArtifact({
        artifact: {
          ...baseArtifact,
          erc6492: {
            kind: 'wrap-deployless',
            factory: validator,
            factoryData: '0x',
          },
        },
        context: signingContext,
        validatorContribution: rawSignature,
      }),
    ).toThrow('forbidden')

    const reuse = {
      ...baseArtifact,
      id: 'reused',
      stageId: 'reuse',
      input: {
        kind: 'reuse-artifact' as const,
        stageId: 'origin',
        artifactId: 'dual',
        selection: 'pre-claim' as const,
      },
      validatorCodec: { kind: 'none' as const },
      accountEnvelope: { kind: 'none' as const },
    }
    const stageInput = {
      plan: createIntentSigningPlan(ownerPlanInput()),
      stagePlan: {
        id: 'reuse',
        checkpoint: { kind: 'none' as const, id: 'none' },
        priorOutputs: [],
        taskTemplates: [],
        schedule: [],
        artifacts: [reuse],
      },
      stage: { stageId: 'reuse', facts: [], tasks: [], schedule: [] },
      results: {},
      priorOutputs: {
        'origin:dual': {
          preClaimSig: '0x1234' as Hex,
          notarizedClaimSig: '0xabcd' as Hex,
        },
      },
    }
    expect(assembleIntentStage(stageInput, signingContext)).toEqual({
      reused: '0x1234',
    })
    expect(() =>
      assembleIntentStage({ ...stageInput, priorOutputs: {} }, signingContext),
    ).toThrow('unavailable')

    const direct = {
      ...baseArtifact,
      validatorCodec: { kind: 'none' as const },
      accountEnvelope: { kind: 'none' as const },
    }
    expect(
      assembleIntentStage(
        {
          ...stageInput,
          stagePlan: { ...stageInput.stagePlan, artifacts: [direct] },
          stage: {
            stageId: 'origin',
            facts: [],
            schedule: [],
            tasks: [
              {
                id: 'origin-owner',
                signer: { id: 'owner', kind: 'ecdsa' },
                role: 'owner',
                invocationKind: 'ecdsa-sign-typed-data',
                payload: { source: 'plan-payload', payloadId: intentId },
                invocation: {
                  kind: 'ecdsa-sign-typed-data',
                  typedData: typedData(1),
                },
              },
            ],
          },
          results: {
            'origin-owner': {
              kind: 'ecdsa-signature',
              signature: rawSignature,
            },
          },
        },
        signingContext,
      ).origin,
    ).toBe(rawSignature)
    expect(() =>
      assembleIntentStage(
        {
          ...stageInput,
          stagePlan: {
            ...stageInput.stagePlan,
            artifacts: [
              {
                ...direct,
                input: { kind: 'task-results', taskIds: [] },
              },
            ],
          },
        },
        signingContext,
      ),
    ).toThrow('requires one task')
    expect(() =>
      assembleIntentStage(
        {
          ...stageInput,
          stagePlan: { ...stageInput.stagePlan, artifacts: [direct] },
          results: {},
        },
        signingContext,
      ),
    ).toThrow('requires an ECDSA result')
  })

  test('preserves dual-session reads and distinct notarized/pre-claim prompts', async () => {
    const originData = typedData(chain.id)
    const targetData = typedData(destinationChain.id)
    const permissionId = `0x${'66'.repeat(32)}` as Hex
    const notarizedId = `0x${'77'.repeat(32)}` as Hex
    const preClaimId = hashTypedData(originData)
    const intent: IntentSigningInput = {
      id: intentId,
      preparedSignatureMode: 'session-with-execution-verification',
      configuredTopology: topology,
      effectiveSelection: selection,
      origins: [
        {
          id: preClaimId,
          chain,
          role: 'origin',
          typedData: originData,
          usage: 'intent-origin',
        },
      ],
      destination: {
        mode: 'reuse-origin',
        artifactId: 'destination-pre-claim',
        originArtifactId: 'origin-dual',
        selection: 'pre-claim',
      },
      target: {
        id: hashTypedData(targetData),
        chain: destinationChain,
        role: 'target',
        typedData: targetData,
        usage: 'intent-target',
      },
      artifacts: [
        {
          id: 'origin-dual',
          usage: 'intent-origin',
          payloadId: preClaimId,
          cardinality: 'per-origin',
          shape: 'session-claims',
          exposedForIndependentSigning: false,
        },
        {
          id: 'destination-pre-claim',
          usage: 'intent-destination',
          payloadId: preClaimId,
          cardinality: 'one',
          shape: 'hex',
          exposedForIndependentSigning: false,
        },
        {
          id: 'target-pre-claim',
          usage: 'intent-target',
          payloadId: hashTypedData(targetData),
          cardinality: 'one',
          shape: 'hex',
          exposedForIndependentSigning: false,
        },
      ],
    }
    const sessionCodec = (mode: 'notarized' | 'pre-claim') => ({
      kind: 'smart-session' as const,
      validator: { kind: 'validator' as const, address: validator },
      mode,
      permissionId,
    })
    const sessionStateCodec = {
      kind: 'smart-session-state' as const,
      factId: 'origin-enabled',
      whenEnabled: sessionCodec('pre-claim'),
      whenDisabled: {
        kind: 'smart-session' as const,
        validator: { kind: 'validator' as const, address: validator },
        mode: 'enable-and-use' as const,
        permissionId,
        enableData: {
          userSignature: rawSignature,
          hashesAndChainIds: [{ chainId: 1n, sessionDigest: preClaimId }],
          sessionToEnableIndex: 0,
          session: {
            sessionValidator: validator,
            sessionValidatorInitData: '0x' as Hex,
            salt: `0x${'00'.repeat(32)}` as Hex,
            erc7739Policies: {
              allowedERC7739Content: [],
              erc1271Policies: [],
            },
            actions: [],
            claimPolicies: [],
          },
        },
      },
    }
    const planInput: IntentSigningPlanCreationInput = {
      intent,
      payloads: {
        [notarizedId]: { kind: 'message', message: { raw: notarizedId } },
        [preClaimId]: { kind: 'typed-data', typedData: originData },
      },
      stages: [
        {
          id: 'origin',
          checkpoint: {
            kind: 'session-enabled',
            id: 'origin-enabled',
            chain,
            account,
            permissionId,
          },
          priorOutputs: [],
          tasks: [
            {
              id: 'notarized',
              signer: { id: 'owner', kind: 'ecdsa' },
              role: 'session-notarized',
              chain,
              invocationKind: 'ecdsa-sign-message',
              payload: { source: 'plan-payload', payloadId: notarizedId },
              contribution: {
                kind: 'session',
                recoveryEncoding: 'ethereum',
              },
            },
            {
              id: 'pre-claim',
              signer: { id: 'owner', kind: 'ecdsa' },
              role: 'session-pre-claim',
              chain,
              invocationKind: 'ecdsa-sign-typed-data',
              payload: { source: 'plan-payload', payloadId: preClaimId },
              contribution: {
                kind: 'session',
                recoveryEncoding: 'ethereum',
              },
            },
          ],
          schedule: [
            {
              id: 'session-prompts',
              execution: 'serial',
              taskIds: ['notarized', 'pre-claim'],
            },
          ],
          artifacts: [
            {
              id: 'origin-notarized',
              usage: 'intent-notarized-claim',
              input: { kind: 'task-results', taskIds: ['notarized'] },
              validatorCodec: sessionCodec('notarized'),
              erc7739: { kind: 'none' },
              accountEnvelope: { kind: 'nexus', validator },
              erc6492: { kind: 'none' },
            },
            {
              id: 'origin-pre-claim',
              usage: 'intent-pre-claim',
              input: { kind: 'task-results', taskIds: ['pre-claim'] },
              validatorCodec: sessionStateCodec,
              erc7739: { kind: 'none' },
              accountEnvelope: { kind: 'none' },
              erc6492: { kind: 'none' },
            },
            {
              id: 'origin-dual',
              usage: 'intent-origin',
              input: {
                kind: 'session-claim-pair',
                preClaimArtifactId: 'origin-pre-claim',
                notarizedClaimArtifactId: 'origin-notarized',
              },
              validatorCodec: { kind: 'none' },
              erc7739: { kind: 'none' },
              accountEnvelope: { kind: 'none' },
              erc6492: { kind: 'none' },
            },
          ],
        },
        ...(['destination', 'target'] as const).map((id) => ({
          id,
          checkpoint: {
            kind: 'session-enabled' as const,
            id: `${id}-enabled`,
            chain: destinationChain,
            account,
            permissionId,
          },
          priorOutputs: [
            {
              stageId: 'origin',
              outputId: 'origin-dual',
              selection: 'pre-claim' as const,
            },
          ],
          tasks: [],
          schedule: [],
          artifacts: [
            {
              id: `${id}-pre-claim`,
              usage:
                id === 'target'
                  ? ('intent-target' as const)
                  : ('intent-destination' as const),
              input: {
                kind: 'reuse-artifact' as const,
                stageId: 'origin',
                artifactId: 'origin-dual',
                selection: 'pre-claim' as const,
              },
              validatorCodec: { kind: 'none' as const },
              erc7739: { kind: 'none' as const },
              accountEnvelope: { kind: 'none' as const },
              erc6492: { kind: 'none' as const },
            },
          ],
        })),
      ],
    }
    const reads: string[] = []
    const invoke = vi.fn(async () => ({
      kind: 'ecdsa-signature' as const,
      signature: rawSignature,
    }))
    const transcript = await executeIntentSigning({
      planInput,
      context: context(invoke),
      checkpoints: {
        read: async (checkpoint) => {
          reads.push(checkpoint.id)
          return [{ kind: 'session-enabled', id: checkpoint.id, enabled: true }]
        },
      },
    })
    expect(reads).toEqual([
      'origin-enabled',
      'destination-enabled',
      'target-enabled',
    ])
    expect(invoke.mock.calls.map(([, invocation]) => invocation.kind)).toEqual([
      'ecdsa-sign-message',
      'ecdsa-sign-typed-data',
    ])
    expect(transcript.stages[1].outputs['destination-pre-claim']).toBe(
      (transcript.stages[0].outputs['origin-dual'] as { preClaimSig: Hex })
        .preClaimSig,
    )
    expect(transcript.stages[2].outputs['target-pre-claim']).toBe(
      (transcript.stages[0].outputs['origin-dual'] as { preClaimSig: Hex })
        .preClaimSig,
    )
    const fresh = await executeIntentSigning({
      planInput,
      context: context(invoke),
      checkpoints: {
        read: async (checkpoint) => [
          {
            kind: 'session-enabled',
            id: checkpoint.id,
            enabled: checkpoint.id !== 'origin-enabled',
          },
        ],
      },
    })
    expect(
      (fresh.stages[0].outputs['origin-dual'] as { preClaimSig: Hex })
        .preClaimSig,
    ).toMatch(/^0x01/)
  })

  test('rejects a plan whose artifact cardinality contradicts prepared mode', () => {
    const input = ownerPlanInput()
    input.intent.artifacts.length = 0
    expect(() => createIntentSigningPlan(input)).toThrow(
      'requires 1 origin artifacts',
    )
  })

  test('rejects inconsistent semantic intent routes before execution', () => {
    const plan = createIntentSigningPlan(ownerPlanInput())
    expect(() =>
      projectIndependentSigning({ ...plan, kind: 'account-message' }, [
        'owner',
      ]),
    ).toThrow('requires a full intent plan')

    const duplicate = ownerPlanInput()
    expect(() =>
      createIntentSigningPlan({
        ...duplicate,
        intent: {
          ...duplicate.intent,
          artifacts: [
            ...duplicate.intent.artifacts,
            { ...duplicate.intent.artifacts[1] },
          ],
        },
      }),
    ).toThrow('duplicate ids')

    const missingRoute = ownerPlanInput()
    expect(() =>
      createIntentSigningPlan({
        ...missingRoute,
        stages: missingRoute.stages.map((stage) => ({
          ...stage,
          artifacts: stage.artifacts.filter(({ id }) => id !== 'destination'),
        })),
      }),
    ).toThrow('has no assembly route')

    const missingRequirement = ownerPlanInput()
    expect(() =>
      createIntentSigningPlan({
        ...missingRequirement,
        intent: {
          ...missingRequirement.intent,
          destination: {
            mode: 'reuse-origin',
            artifactId: 'unknown-destination',
            originArtifactId: 'origin',
            selection: 'whole',
          },
        },
      }),
    ).toThrow('requirement is missing')

    const incompatibleReuse = ownerPlanInput()
    expect(() =>
      createIntentSigningPlan({
        ...incompatibleReuse,
        intent: {
          ...incompatibleReuse.intent,
          destination: {
            ...incompatibleReuse.intent.destination,
            mode: 'reuse-origin',
            selection: 'pre-claim',
          } as never,
        },
      }),
    ).toThrow('reuse route is incompatible')

    const signedDestination = ownerPlanInput()
    const destinationPayload = signedDestination.intent.origins[0]
    expect(() =>
      createIntentSigningPlan({
        ...signedDestination,
        intent: {
          ...signedDestination.intent,
          destination: {
            mode: 'sign',
            artifactId: 'destination',
            payload: destinationPayload,
          },
        },
        stages: signedDestination.stages.map((stage) => ({
          ...stage,
          artifacts: stage.artifacts.map((artifact) =>
            artifact.id === 'destination'
              ? {
                  ...artifact,
                  input: { kind: 'task-results' as const, taskIds: [] },
                }
              : artifact,
          ),
        })),
      }),
    ).not.toThrow()

    const incompatibleDestination = ownerPlanInput()
    expect(() =>
      createIntentSigningPlan({
        ...incompatibleDestination,
        intent: {
          ...incompatibleDestination.intent,
          destination: {
            mode: 'sign',
            artifactId: 'destination',
            payload: {
              ...incompatibleDestination.intent.origins[0],
              id: `0x${'12'.repeat(32)}`,
            },
          },
        },
      }),
    ).toThrow('signing route is incompatible')

    const missingTarget = ownerPlanInput()
    expect(() =>
      createIntentSigningPlan({
        ...missingTarget,
        intent: {
          ...missingTarget.intent,
          target: missingTarget.intent.origins[0],
        },
      }),
    ).toThrow('target requires exactly one artifact')

    const duplicateTarget = ownerPlanInput()
    const target = duplicateTarget.intent.origins[0]
    expect(() =>
      createIntentSigningPlan({
        ...duplicateTarget,
        intent: {
          ...duplicateTarget.intent,
          target,
          artifacts: [
            ...duplicateTarget.intent.artifacts,
            {
              id: 'target-a',
              usage: 'intent-target',
              payloadId: target.id,
              cardinality: 'one',
              shape: 'hex',
              exposedForIndependentSigning: false,
            },
            {
              id: 'target-b',
              usage: 'intent-target',
              payloadId: target.id,
              cardinality: 'one',
              shape: 'hex',
              exposedForIndependentSigning: false,
            },
          ],
        },
      }),
    ).toThrow('target requires exactly one artifact')

    const wrongShape = ownerPlanInput()
    wrongShape.intent.artifacts[0].shape = 'session-claims'
    expect(() => createIntentSigningPlan(wrongShape)).toThrow(
      'requires hex origin artifacts',
    )
  })

  test('validates independent contribution identity and serialization levels', () => {
    const artifact = createIntentSigningPlan(ownerPlanInput()).stages[0]
      .artifacts[0]
    const signingContext = context()
    const valid = {
      intentId,
      kind: 'ecdsa' as const,
      signer: owner,
      origin: [`0x${'55'.repeat(64)}1f` as Hex],
    }
    const assemble = (
      signatures: Parameters<
        typeof assembleIndependentIntentArtifact
      >[0]['signatures'],
      owners: Parameters<
        typeof assembleIndependentIntentArtifact
      >[0]['owners'] = [{ ownerId: 'owner/a', identity: owner, kind: 'ecdsa' }],
    ) =>
      assembleIndependentIntentArtifact({
        intentId,
        originIndex: 0,
        originCount: 1,
        signatures,
        owners,
        artifact,
        context: signingContext,
      })

    expect(() => assemble([{ ...valid, intentId: 'other' }])).toThrowError(
      MismatchedOwnerSignaturesError,
    )
    expect(() => assemble([{ ...valid, origin: [] }])).toThrowError(
      MismatchedOwnerSignaturesError,
    )
    expect(() =>
      assemble([
        {
          ...valid,
          signer: '0x9999999999999999999999999999999999999999',
        },
      ]),
    ).toThrowError(UnknownOwnerError)
    expect(() => assemble([valid, valid])).toThrowError(
      MismatchedOwnerSignaturesError,
    )
    expect(() =>
      assemble(
        [valid],
        [{ ownerId: 'owner/a', identity: owner, kind: 'webauthn' }],
      ),
    ).toThrowError(MismatchedOwnerSignaturesError)
    expect(() =>
      assemble(
        [
          {
            intentId,
            kind: 'multi-factor',
            validatorId: 2,
            signature: {
              kind: 'ecdsa',
              signer: owner,
              origin: valid.origin,
            },
          },
        ],
        [
          {
            ownerId: 'owner/a',
            identity: owner,
            kind: 'ecdsa',
            factorId: 'factor',
            factorPublicId: 1,
          },
        ],
      ),
    ).toThrowError(MismatchedOwnerSignaturesError)
    expect(() =>
      assemble(
        [valid],
        [
          {
            ownerId: 'owner/a',
            identity: owner,
            kind: 'ecdsa',
            factorId: 'factor',
            factorPublicId: 1,
          },
        ],
      ),
    ).toThrowError(MismatchedOwnerSignaturesError)
    expect(() =>
      assembleIndependentIntentArtifact({
        intentId,
        originIndex: 0,
        originCount: 1,
        signatures: [valid],
        owners: [{ ownerId: 'owner/a', identity: owner, kind: 'ecdsa' }],
        artifact: { ...artifact, validatorCodec: { kind: 'none' } },
        context: signingContext,
      }),
    ).toThrow('requires a validator codec')

    for (const validatorCodec of [
      {
        kind: 'smart-session' as const,
        validator: { kind: 'validator' as const, address: validator },
        mode: 'pre-claim' as const,
        permissionId: `0x${'66'.repeat(32)}` as Hex,
      },
      {
        kind: 'smart-session-state' as const,
        factId: 'session-state',
        whenEnabled: {
          kind: 'smart-session' as const,
          validator: { kind: 'validator' as const, address: validator },
          mode: 'pre-claim' as const,
          permissionId: `0x${'66'.repeat(32)}` as Hex,
        },
        whenDisabled: {
          kind: 'smart-session' as const,
          validator: { kind: 'validator' as const, address: validator },
          mode: 'pre-claim' as const,
          permissionId: `0x${'66'.repeat(32)}` as Hex,
        },
      },
    ]) {
      expect(() =>
        assembleIndependentIntentArtifact({
          intentId,
          originIndex: 0,
          originCount: 1,
          signatures: [valid],
          owners: [{ ownerId: 'owner/a', identity: owner, kind: 'ecdsa' }],
          artifact: { ...artifact, validatorCodec },
          context: signingContext,
        }),
      ).toThrow('cannot be signed independently')
    }
  })

  test('reports insufficient independent atomic and MFA signatures', () => {
    const artifact = createIntentSigningPlan(ownerPlanInput()).stages[0]
      .artifacts[0]
    const signingContext = context()
    const signature = {
      intentId,
      kind: 'ecdsa' as const,
      signer: owner,
      origin: [`0x${'55'.repeat(64)}1f` as Hex],
    }
    const assemble = (
      artifactOverride: typeof artifact,
      signatures: Parameters<
        typeof assembleIndependentIntentArtifact
      >[0]['signatures'],
      owners: Parameters<typeof assembleIndependentIntentArtifact>[0]['owners'],
    ) =>
      assembleIndependentIntentArtifact({
        intentId,
        originIndex: 0,
        originCount: 1,
        signatures,
        owners,
        artifact: artifactOverride,
        context: signingContext,
      })

    expect(() =>
      assemble(
        {
          ...artifact,
          validatorCodec: {
            ...codec,
            ownerOrder: ['owner/a', 'owner/b'],
            threshold: 2,
          },
        },
        [signature],
        [{ ownerId: 'owner/a', identity: owner, kind: 'ecdsa' }],
      ),
    ).toThrowError(InsufficientOwnerSignaturesError)

    const factor = {
      id: 'factor-a',
      publicId: 1,
      validator,
      codec: {
        ...codec,
        ownerOrder: ['owner/a', 'owner/b'],
        threshold: 2,
      },
    }
    const factorSignature = {
      intentId,
      kind: 'multi-factor' as const,
      validatorId: 1,
      signature: {
        kind: 'ecdsa' as const,
        signer: owner,
        origin: signature.origin,
      },
    }
    const factorOwner = {
      ownerId: 'owner/a',
      identity: owner,
      kind: 'ecdsa' as const,
      factorId: factor.id,
      factorPublicId: factor.publicId,
    }
    expect(() =>
      assemble(
        {
          ...artifact,
          validatorCodec: {
            kind: 'nested-threshold',
            validator: { kind: 'validator', address: validator },
            factorOrder: [factor.id],
            threshold: 1,
          },
          validatorFactors: [factor],
        },
        [factorSignature],
        [factorOwner],
      ),
    ).toThrowError(InsufficientOwnerSignaturesError)

    expect(() =>
      assemble(
        {
          ...artifact,
          validatorCodec: {
            kind: 'nested-threshold',
            validator: { kind: 'validator', address: validator },
            factorOrder: [factor.id, 'factor-b'],
            threshold: 2,
          },
          validatorFactors: [
            { ...factor, codec: { ...factor.codec, threshold: 1 } },
          ],
        },
        [factorSignature],
        [factorOwner],
      ),
    ).toThrowError(InsufficientOwnerSignaturesError)

    expect(() =>
      assemble(
        {
          ...artifact,
          validatorCodec: {
            kind: 'nested-threshold',
            validator: { kind: 'validator', address: validator },
            factorOrder: [factor.id],
            threshold: 1,
          },
          validatorFactors: [
            { ...factor, codec: { ...factor.codec, threshold: 1 } },
          ],
        },
        [{ ...factorSignature, validatorId: `0x${'11'.repeat(13)}` }],
        [factorOwner],
      ),
    ).toThrowError(MismatchedOwnerSignaturesError)
  })
})
