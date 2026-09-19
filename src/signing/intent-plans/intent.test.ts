import { concat, type Hex, hashTypedData, type TypedDataDefinition } from 'viem'
import { describe, expect, test, vi } from 'vitest'
import type {
  AccountAdapter,
  AccountSignatureEnvelopeInput,
} from '../../accounts/adapter'
import {
  InsufficientOwnerSignaturesError,
  MismatchedOwnerSignaturesError,
  UnknownOwnerError,
} from '../../errors/execution'
import type { SigningContext } from '../context'
import type { SignerInvocation, SignerReference } from '../types'
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
const account = '0x1111111111111111111111111111111111111111' as const
const owner = '0x2222222222222222222222222222222222222222' as const
const validator = '0x3333333333333333333333333333333333333333' as const
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

type DeepMutable<T> = {
  -readonly [Key in keyof T]: DeepMutable<T[Key]>
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
      encodeSignatureEnvelope: ({
        validatorContribution,
      }: AccountSignatureEnvelopeInput) =>
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

type Eip712Request = Extract<
  IntentSigningInput['requests'][number],
  { kind: 'eip712' }
>

function eip712(
  request: IntentSigningInput['requests'][number],
): Eip712Request {
  if (request.kind !== 'eip712') throw new Error('Expected an EIP-712 request')
  return request
}

/** Turns a reused slot into one that has to be signed in its own right. */
function withoutReuse(
  request: IntentSigningInput['requests'][number],
): Eip712Request {
  const { reuse: _reuse, ...rest } = eip712(request)
  return rest
}

function ownerIntent(): IntentSigningInput {
  const data = typedData(chain.id)
  const payload = { id: hashTypedData(data), chain, typedData: data }
  return {
    id: intentId,
    preparedSignatureMode: 'default',
    configuredTopology: topology,
    effectiveSelection: selection,
    requests: [
      {
        kind: 'eip712',
        index: 0,
        purpose: 'originAuthorization',
        artifactId: 'request-0',
        signatureFormat: 'account',
        payload: { ...payload, usage: 'intent-origin' },
        shape: 'hex',
        exposedForIndependentSigning: true,
      },
      // The destination leg authorises the same payload under the same
      // authority, so its slot is satisfiable by the origin signature — it is
      // still its own slot in the proof vector.
      {
        kind: 'eip712',
        index: 1,
        purpose: 'destinationAuthorization',
        artifactId: 'request-1',
        signatureFormat: 'account',
        payload: { ...payload, usage: 'intent-destination' },
        shape: 'hex',
        reuse: { artifactId: 'request-0', selection: 'whole' },
        exposedForIndependentSigning: false,
      },
    ],
    artifacts: [
      {
        id: 'request-0',
        usage: 'intent-origin',
        payloadId: payload.id,
        cardinality: 'one',
        shape: 'hex',
        exposedForIndependentSigning: true,
      },
      {
        id: 'request-1',
        usage: 'intent-destination',
        payloadId: payload.id,
        cardinality: 'one',
        shape: 'hex',
        exposedForIndependentSigning: false,
      },
    ],
  }
}

function ownerPlanInput(): IntentSigningPlanCreationInput {
  const intent = ownerIntent()
  const request = eip712(intent.requests[0])
  const payloadId = request.payload.id
  return {
    intent,
    payloads: {
      [payloadId]: {
        kind: 'typed-data',
        typedData: request.payload.typedData,
      },
    },
    stages: [
      {
        id: 'request-0',
        checkpoint: { kind: 'none', id: 'request-0:none' },
        priorOutputs: [],
        tasks: [
          {
            id: 'request-0-owner',
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
            id: 'request-0-prompt',
            execution: 'parallel',
            taskIds: ['request-0-owner'],
          },
        ],
        artifacts: [
          {
            id: 'request-0',
            usage: 'intent-origin',
            input: { kind: 'task-results', taskIds: ['request-0-owner'] },
            validatorCodec: codec,
            erc7739: { kind: 'none' },
            accountEnvelope: { kind: 'nexus', validator },
            erc6492: { kind: 'none' },
          },
        ],
      },
      {
        id: 'request-1',
        checkpoint: { kind: 'none', id: 'request-1:none' },
        priorOutputs: [
          { stageId: 'request-0', outputId: 'request-0', selection: 'whole' },
        ],
        tasks: [],
        schedule: [],
        artifacts: [
          {
            id: 'request-1',
            usage: 'intent-destination',
            input: {
              kind: 'reuse-artifact',
              stageId: 'request-0',
              artifactId: 'request-0',
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
    const fullSignature = full.stages[0].outputs['request-0']
    expect(full.stages[1].outputs['request-1']).toBe(fullSignature)

    const artifact = createIntentSigningPlan(planInput).stages[0].artifacts[0]
    const independent = assembleIndependentIntentArtifact({
      intentId,
      slotIndex: 0,
      slotCount: 1,
      signatures: [
        {
          intentId,
          kind: 'ecdsa',
          signer: owner,
          slots: [`0x${'55'.repeat(64)}1f`],
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
      clientDataJSON: '{"type":"webauthn.get","challenge":"value"}',
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
      requests: [
        {
          kind: 'eip712',
          index: 0,
          purpose: 'originAuthorization',
          artifactId: 'request-0',
          signatureFormat: 'account',
          payload: {
            id: payloadId,
            chain,
            typedData: data,
            usage: 'intent-origin',
          },
          shape: 'hex',
          exposedForIndependentSigning: true,
        },
      ],
      artifacts: [
        {
          id: 'request-0',
          usage: 'intent-origin',
          payloadId,
          cardinality: 'one',
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
          id: 'request-0',
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
              id: 'request-0',
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
      slotIndex: 0,
      slotCount: 1,
      signatures: [
        {
          intentId,
          kind: 'multi-factor',
          validatorId: 1,
          signature: {
            kind: 'ecdsa',
            signer: owner,
            slots: [`0x${'55'.repeat(64)}1f`],
          },
        },
        {
          intentId,
          kind: 'multi-factor',
          validatorId: '0x02',
          signature: {
            kind: 'passkey',
            publicKey: passkey,
            slots: [{ webauthn: assertion, signature: passkeySignature }],
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
    expect(independent).toBe(full.stages[0].outputs['request-0'])
  })

  test('projects atomic owner tasks without cloning assembly byte logic', () => {
    const plan = createIntentSigningPlan(ownerPlanInput())
    expect(plan.preparedIntent).toMatchObject({
      signatureMode: 'default',
      reuses: [
        {
          artifactId: 'request-1',
          sourceArtifactId: 'request-0',
          selection: 'whole',
        },
      ],
    })
    const projected = projectIndependentSigning(plan, ['owner'])
    expect(projected.plan.kind).toBe('intent-independent')
    expect(projected.plan.stages[0].artifacts).toEqual([])
    expect(projected.plan.publicOutputs).toEqual([
      {
        id: 'request-0-owner-contribution',
        source: { kind: 'task-result', taskId: 'request-0-owner' },
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
            stageId: 'request-0',
            facts: [],
            schedule: [],
            tasks: [
              {
                id: 'request-0-owner',
                signer: { id: 'owner', kind: 'ecdsa' },
                role: 'owner',
                payload: { source: 'plan-payload', payloadId: intentId },
                invocation: {
                  kind: 'ecdsa-sign-typed-data',
                  typedData: typedData(1),
                },
              },
            ],
          },
          results: {
            'request-0-owner': {
              kind: 'ecdsa-signature',
              signature: rawSignature,
            },
          },
        },
        signingContext,
      )['request-0'],
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
    const permissionId = `0x${'66'.repeat(32)}` as Hex
    const notarizedId = `0x${'77'.repeat(32)}` as Hex
    const preClaimId = hashTypedData(originData)
    // The destination and target legs authorise the payload the origin leg
    // already authorised, so both slots reuse its pre-claim half — reuse is
    // only ever legitimate where the payload and the authority are identical.
    const payload = { id: preClaimId, chain, typedData: originData }
    const intent: IntentSigningInput = {
      id: intentId,
      preparedSignatureMode: 'session-with-execution-verification',
      configuredTopology: topology,
      effectiveSelection: selection,
      requests: [
        {
          kind: 'eip712',
          index: 0,
          purpose: 'originAuthorization',
          artifactId: 'request-0',
          signatureFormat: 'account',
          payload: { ...payload, usage: 'intent-origin' },
          shape: 'session-claims',
          exposedForIndependentSigning: false,
        },
        {
          kind: 'eip712',
          index: 1,
          purpose: 'destinationAuthorization',
          artifactId: 'request-1',
          signatureFormat: 'account',
          payload: { ...payload, usage: 'intent-destination' },
          shape: 'hex',
          reuse: { artifactId: 'request-0', selection: 'pre-claim' },
          exposedForIndependentSigning: false,
        },
        {
          kind: 'eip712',
          index: 2,
          purpose: 'targetExecutionAuthorization',
          artifactId: 'request-2',
          signatureFormat: 'account',
          payload: { ...payload, usage: 'intent-target' },
          shape: 'hex',
          reuse: { artifactId: 'request-0', selection: 'pre-claim' },
          exposedForIndependentSigning: false,
        },
      ],
      artifacts: [
        {
          id: 'request-0',
          usage: 'intent-origin',
          payloadId: preClaimId,
          cardinality: 'one',
          shape: 'session-claims',
          exposedForIndependentSigning: false,
        },
        {
          id: 'request-1',
          usage: 'intent-destination',
          payloadId: preClaimId,
          cardinality: 'one',
          shape: 'hex',
          exposedForIndependentSigning: false,
        },
        {
          id: 'request-2',
          usage: 'intent-target',
          payloadId: preClaimId,
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
      factId: 'request-0-enabled',
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
          id: 'request-0',
          checkpoint: {
            kind: 'session-enabled',
            id: 'request-0-enabled',
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
              id: 'request-0:notarized',
              usage: 'intent-notarized-claim',
              input: { kind: 'task-results', taskIds: ['notarized'] },
              validatorCodec: sessionCodec('notarized'),
              erc7739: { kind: 'none' },
              accountEnvelope: { kind: 'nexus', validator },
              erc6492: { kind: 'none' },
            },
            {
              id: 'request-0:pre-claim',
              usage: 'intent-pre-claim',
              input: { kind: 'task-results', taskIds: ['pre-claim'] },
              validatorCodec: sessionStateCodec,
              erc7739: { kind: 'none' },
              accountEnvelope: { kind: 'none' },
              erc6492: { kind: 'none' },
            },
            {
              id: 'request-0',
              usage: 'intent-origin',
              input: {
                kind: 'session-claim-pair',
                preClaimArtifactId: 'request-0:pre-claim',
                notarizedClaimArtifactId: 'request-0:notarized',
              },
              validatorCodec: { kind: 'none' },
              erc7739: { kind: 'none' },
              accountEnvelope: { kind: 'none' },
              erc6492: { kind: 'none' },
            },
          ],
        },
        ...(['request-1', 'request-2'] as const).map((id) => ({
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
              stageId: 'request-0',
              outputId: 'request-0',
              selection: 'pre-claim' as const,
            },
          ],
          tasks: [],
          schedule: [],
          artifacts: [
            {
              id,
              usage:
                id === 'request-2'
                  ? ('intent-target' as const)
                  : ('intent-destination' as const),
              input: {
                kind: 'reuse-artifact' as const,
                stageId: 'request-0',
                artifactId: 'request-0',
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
    const invoke = vi.fn(
      async (_signer: SignerReference, _invocation: SignerInvocation) => ({
        kind: 'ecdsa-signature' as const,
        signature: rawSignature,
      }),
    )
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
      'request-0-enabled',
      'request-1-enabled',
      'request-2-enabled',
    ])
    expect(invoke.mock.calls.map(([, invocation]) => invocation.kind)).toEqual([
      'ecdsa-sign-message',
      'ecdsa-sign-typed-data',
    ])
    expect(transcript.stages[1].outputs['request-1']).toBe(
      (transcript.stages[0].outputs['request-0'] as { preClaimSig: Hex })
        .preClaimSig,
    )
    expect(transcript.stages[2].outputs['request-2']).toBe(
      (transcript.stages[0].outputs['request-0'] as { preClaimSig: Hex })
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
            enabled: checkpoint.id !== 'request-0-enabled',
          },
        ],
      },
    })
    expect(
      (fresh.stages[0].outputs['request-0'] as { preClaimSig: Hex })
        .preClaimSig,
    ).toMatch(/^0x01/)
  })

  test('rejects a plan whose artifact count contradicts prepared mode', () => {
    const input =
      ownerPlanInput() as DeepMutable<IntentSigningPlanCreationInput>
    input.intent.artifacts.length = 0
    expect(() => createIntentSigningPlan(input)).toThrow(
      'requires 1 signed artifacts, received 0',
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
          artifacts: stage.artifacts.filter(({ id }) => id !== 'request-1'),
        })),
      }),
    ).toThrow('Intent artifact request-1 has no assembly route')

    const missingRequirement = ownerPlanInput()
    expect(() =>
      createIntentSigningPlan({
        ...missingRequirement,
        intent: {
          ...missingRequirement.intent,
          requests: [
            missingRequirement.intent.requests[0],
            {
              ...eip712(missingRequirement.intent.requests[1]),
              artifactId: 'unknown-request',
            },
          ],
        },
      }),
    ).toThrow('request 1 has no artifact requirement')

    const incompatibleReuse = ownerPlanInput()
    expect(() =>
      createIntentSigningPlan({
        ...incompatibleReuse,
        intent: {
          ...incompatibleReuse.intent,
          requests: [
            incompatibleReuse.intent.requests[0],
            {
              ...eip712(incompatibleReuse.intent.requests[1]),
              reuse: {
                artifactId: 'request-0',
                selection: 'pre-claim' as const,
              },
            },
          ],
        },
      }),
    ).toThrow('request 1 reuse route is incompatible')

    // A destination leg that is signed in its own right, rather than reusing
    // the origin signature, is a valid plan.
    const signedDestination = ownerPlanInput()
    expect(() =>
      createIntentSigningPlan({
        ...signedDestination,
        intent: {
          ...signedDestination.intent,
          requests: [
            signedDestination.intent.requests[0],
            withoutReuse(signedDestination.intent.requests[1]),
          ],
        },
        stages: signedDestination.stages.map((stage) => ({
          ...stage,
          artifacts: stage.artifacts.map((artifact) =>
            artifact.id === 'request-1'
              ? {
                  ...artifact,
                  input: { kind: 'task-results' as const, taskIds: [] },
                }
              : artifact,
          ),
        })),
      }),
    ).not.toThrow()

    // A slot that has to be signed cannot be satisfied by a reuse route.
    const reusedWithoutReuse = ownerPlanInput()
    expect(() =>
      createIntentSigningPlan({
        ...reusedWithoutReuse,
        intent: {
          ...reusedWithoutReuse.intent,
          requests: [
            reusedWithoutReuse.intent.requests[0],
            withoutReuse(reusedWithoutReuse.intent.requests[1]),
          ],
        },
      }),
    ).toThrow('request 1 signing route is incompatible')

    const incompatibleDestination = ownerPlanInput()
    const destinationRequest = withoutReuse(
      incompatibleDestination.intent.requests[1],
    )
    expect(() =>
      createIntentSigningPlan({
        ...incompatibleDestination,
        intent: {
          ...incompatibleDestination.intent,
          requests: [
            incompatibleDestination.intent.requests[0],
            {
              ...destinationRequest,
              payload: {
                ...destinationRequest.payload,
                id: `0x${'12'.repeat(32)}`,
              },
            },
          ],
        },
        stages: incompatibleDestination.stages.map((stage) => ({
          ...stage,
          artifacts: stage.artifacts.map((artifact) =>
            artifact.id === 'request-1'
              ? {
                  ...artifact,
                  input: { kind: 'task-results' as const, taskIds: [] },
                }
              : artifact,
          ),
        })),
      }),
    ).toThrow('request 1 signing route is incompatible')

    // A target execution authorisation is no longer a distinct field with its
    // own cardinality rule: it is one more slot, held to the same route rules.
    const missingTargetRoute = ownerPlanInput()
    const targetPayload = eip712(missingTargetRoute.intent.requests[0]).payload
    expect(() =>
      createIntentSigningPlan({
        ...missingTargetRoute,
        intent: {
          ...missingTargetRoute.intent,
          requests: [
            ...missingTargetRoute.intent.requests,
            {
              kind: 'eip712',
              index: 2,
              purpose: 'targetExecutionAuthorization',
              artifactId: 'request-2',
              signatureFormat: 'account',
              payload: { ...targetPayload, usage: 'intent-target' },
              shape: 'hex',
              exposedForIndependentSigning: false,
            },
          ],
          artifacts: [
            ...missingTargetRoute.intent.artifacts,
            {
              id: 'request-2',
              usage: 'intent-target',
              payloadId: targetPayload.id,
              cardinality: 'one',
              shape: 'hex',
              exposedForIndependentSigning: false,
            },
          ],
        },
      }),
    ).toThrow('Intent artifact request-2 has no assembly route')

    const wrongShape =
      ownerPlanInput() as DeepMutable<IntentSigningPlanCreationInput>
    wrongShape.intent.artifacts[0].shape = 'session-claims'
    expect(() => createIntentSigningPlan(wrongShape)).toThrow(
      'requires hex artifacts',
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
      slots: [`0x${'55'.repeat(64)}1f` as Hex],
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
        slotIndex: 0,
        slotCount: 1,
        signatures,
        owners,
        artifact,
        context: signingContext,
      })

    expect(() => assemble([{ ...valid, intentId: 'other' }])).toThrowError(
      MismatchedOwnerSignaturesError,
    )
    expect(() => assemble([{ ...valid, slots: [] }])).toThrowError(
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
              slots: valid.slots,
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
        slotIndex: 0,
        slotCount: 1,
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
          slotIndex: 0,
          slotCount: 1,
          signatures: [valid],
          owners: [{ ownerId: 'owner/a', identity: owner, kind: 'ecdsa' }],
          artifact: { ...artifact, validatorCodec },
          context: signingContext,
        }),
      ).toThrow('cannot be signed independently')
    }

    expect(() =>
      assembleIndependentIntentArtifact({
        intentId,
        slotIndex: 0,
        slotCount: 1,
        signatures: [valid],
        owners: [{ ownerId: 'owner/a', identity: owner, kind: 'ecdsa' }],
        artifact: {
          ...artifact,
          validatorFactors: [
            {
              id: 'factor',
              publicId: 1,
              validator,
              codec,
            },
          ],
          validatorCodec: codec,
        },
        context: signingContext,
      }),
    ).toThrow('requires a nested codec')
  })

  test('reports insufficient independent atomic and MFA signatures', () => {
    const artifact = createIntentSigningPlan(ownerPlanInput()).stages[0]
      .artifacts[0]
    const signingContext = context()
    const signature = {
      intentId,
      kind: 'ecdsa' as const,
      signer: owner,
      slots: [`0x${'55'.repeat(64)}1f` as Hex],
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
        slotIndex: 0,
        slotCount: 1,
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
        slots: signature.slots,
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
