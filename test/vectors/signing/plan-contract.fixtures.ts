import { concat, type Hex, type TypedDataDefinition } from 'viem'
import type { EvmChainReference } from '../../../src/chains/types'
import type { IntentSigningInput } from '../../../src/signing/intent-plans/types'
import type {
  RawSignerResult,
  SigningPlan,
  SigningTranscript,
} from '../../../src/signing/types'

const account = '0x1111111111111111111111111111111111111111'
const sessionValidator = '0x2222222222222222222222222222222222222222'
const mfaValidator = '0x3333333333333333333333333333333333333333'
const ownableValidator = '0x4444444444444444444444444444444444444444'
const passkeyValidator = '0x5555555555555555555555555555555555555555'
const permissionId = `0x${'66'.repeat(32)}` as Hex
const intentId = `0x${'77'.repeat(32)}` as Hex
const originMessageHash = `0x${'88'.repeat(32)}` as Hex
const originTypedDataHash = `0x${'99'.repeat(32)}` as Hex
const originPayloadId = `0x${'aa'.repeat(32)}` as Hex
const targetPayloadId = `0x${'bb'.repeat(32)}` as Hex
const mfaPayloadId = `0x${'cc'.repeat(32)}` as Hex

const base: EvmChainReference = {
  kind: 'evm',
  id: 8453,
  caip2: 'eip155:8453',
}

const arbitrum: EvmChainReference = {
  kind: 'evm',
  id: 42161,
  caip2: 'eip155:42161',
}

const typedData = (chainId: number, value: bigint): TypedDataDefinition => ({
  domain: {
    name: 'Signing contract fixture',
    version: '1',
    chainId,
    verifyingContract: account,
  },
  types: { Fixture: [{ name: 'value', type: 'uint256' }] },
  primaryType: 'Fixture',
  message: { value },
})

const sessionCodec = {
  kind: 'smart-session',
  validator: { kind: 'validator', address: sessionValidator },
  mode: 'pre-claim',
  permissionId,
} as const

export const dualSessionIntentInput: IntentSigningInput = {
  id: intentId,
  preparedSignatureMode: 'session-with-execution-verification',
  configuredTopology: {
    rootValidatorId: 'smart-session',
    validators: [
      { id: 'smart-session', ownerIds: ['session-key'], threshold: 1 },
    ],
    threshold: 1,
  },
  effectiveSelection: {
    validatorIds: ['smart-session'],
    signerIds: ['session-key'],
    threshold: 1,
  },
  origins: [
    {
      id: originPayloadId,
      chain: base,
      role: 'origin',
      typedData: typedData(base.id, 1n),
      usage: 'intent-origin',
    },
  ],
  destination: {
    mode: 'reuse-origin',
    artifactId: 'destination-pre-claim',
    originArtifactId: 'origin-pre-claim',
    selection: 'pre-claim',
  },
  target: {
    id: targetPayloadId,
    chain: arbitrum,
    role: 'target',
    typedData: typedData(arbitrum.id, 2n),
    usage: 'intent-target',
  },
  artifacts: [
    {
      id: 'origin-notarized',
      usage: 'intent-notarized-claim',
      payloadId: originPayloadId,
      cardinality: 'per-origin',
      exposedForIndependentSigning: false,
    },
    {
      id: 'origin-pre-claim',
      usage: 'intent-pre-claim',
      payloadId: originPayloadId,
      cardinality: 'per-origin',
      exposedForIndependentSigning: false,
    },
  ],
}

export const dualSessionPlan: SigningPlan = {
  version: 1,
  kind: 'intent-full',
  payload: { kind: 'intent', id: intentId },
  configuredTopology: dualSessionIntentInput.configuredTopology,
  effectiveSelection: dualSessionIntentInput.effectiveSelection,
  stages: [
    {
      id: 'origin-base',
      checkpoint: {
        kind: 'session-enabled',
        id: 'origin-base-enabled',
        chain: base,
        account,
        permissionId,
      },
      priorOutputs: [],
      taskTemplates: [
        {
          id: 'origin-notarized-task',
          signer: { id: 'session-key', kind: 'ecdsa' },
          role: 'session-notarized',
          chain: base,
          invocationKind: 'ecdsa-sign-message',
          payload: { source: 'plan-payload', payloadId: originMessageHash },
        },
        {
          id: 'origin-pre-claim-task',
          signer: { id: 'session-key', kind: 'ecdsa' },
          role: 'session-pre-claim',
          chain: base,
          invocationKind: 'ecdsa-sign-typed-data',
          payload: { source: 'plan-payload', payloadId: originTypedDataHash },
        },
      ],
      schedule: [
        {
          id: 'origin-session-prompts',
          execution: 'serial',
          taskIds: ['origin-notarized-task', 'origin-pre-claim-task'],
        },
      ],
      artifacts: [
        {
          id: 'origin-notarized',
          stageId: 'origin-base',
          usage: 'intent-notarized-claim',
          input: { kind: 'task-results', taskIds: ['origin-notarized-task'] },
          validatorCodec: { ...sessionCodec, mode: 'notarized' },
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'nexus', validator: sessionValidator },
          erc6492: { kind: 'none' },
        },
        {
          id: 'origin-pre-claim',
          stageId: 'origin-base',
          usage: 'intent-pre-claim',
          input: { kind: 'task-results', taskIds: ['origin-pre-claim-task'] },
          validatorCodec: sessionCodec,
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'none' },
          erc6492: { kind: 'none' },
        },
      ],
    },
    {
      id: 'destination-arbitrum',
      checkpoint: {
        kind: 'session-enabled',
        id: 'destination-enabled',
        chain: arbitrum,
        account,
        permissionId,
      },
      priorOutputs: [
        {
          stageId: 'origin-base',
          outputId: 'origin-pre-claim',
          selection: 'pre-claim',
        },
      ],
      taskTemplates: [],
      schedule: [],
      artifacts: [
        {
          id: 'destination-pre-claim',
          stageId: 'destination-arbitrum',
          usage: 'intent-destination',
          input: {
            kind: 'reuse-artifact',
            stageId: 'origin-base',
            artifactId: 'origin-pre-claim',
            selection: 'pre-claim',
          },
          validatorCodec: { kind: 'none' },
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'none' },
          erc6492: { kind: 'none' },
        },
      ],
    },
    {
      id: 'target-arbitrum',
      checkpoint: {
        kind: 'session-enabled',
        id: 'target-enabled',
        chain: arbitrum,
        account,
        permissionId,
      },
      priorOutputs: [
        {
          stageId: 'origin-base',
          outputId: 'origin-pre-claim',
          selection: 'pre-claim',
        },
      ],
      taskTemplates: [],
      schedule: [],
      artifacts: [
        {
          id: 'target-session',
          stageId: 'target-arbitrum',
          usage: 'intent-target',
          input: {
            kind: 'reuse-artifact',
            stageId: 'origin-base',
            artifactId: 'origin-pre-claim',
            selection: 'pre-claim',
          },
          validatorCodec: { kind: 'none' },
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'none' },
          erc6492: { kind: 'none' },
        },
      ],
    },
  ],
  publicOutputs: [
    {
      id: 'signed-intent',
      source: { kind: 'artifact', artifactId: 'origin-notarized' },
      exposedForIndependentSigning: false,
    },
  ],
}

const notarizedSignature = `0x${'01'.repeat(65)}` as Hex
const preClaimSignature = `0x${'02'.repeat(65)}` as Hex

export const dualSessionTranscript: SigningTranscript = {
  planKind: 'intent-full',
  payloadId: intentId,
  stages: [
    {
      stage: {
        stageId: 'origin-base',
        facts: [
          { kind: 'session-enabled', id: 'origin-base-enabled', enabled: true },
        ],
        tasks: [
          {
            ...dualSessionPlan.stages[0].taskTemplates[0],
            invocation: {
              kind: 'ecdsa-sign-message',
              chain: base,
              message: { raw: originMessageHash },
            },
          },
          {
            ...dualSessionPlan.stages[0].taskTemplates[1],
            invocation: {
              kind: 'ecdsa-sign-typed-data',
              chain: base,
              typedData: dualSessionIntentInput.origins[0].typedData,
            },
          },
        ],
        schedule: dualSessionPlan.stages[0].schedule,
      },
      results: {
        'origin-notarized-task': {
          kind: 'ecdsa-signature',
          signature: notarizedSignature,
        },
        'origin-pre-claim-task': {
          kind: 'ecdsa-signature',
          signature: preClaimSignature,
        },
      },
      outputs: {
        'origin-notarized': notarizedSignature,
        'origin-pre-claim': preClaimSignature,
      },
    },
    {
      stage: {
        stageId: 'destination-arbitrum',
        facts: [
          { kind: 'session-enabled', id: 'destination-enabled', enabled: true },
        ],
        tasks: [],
        schedule: [],
      },
      results: {},
      outputs: { 'destination-pre-claim': preClaimSignature },
    },
    {
      stage: {
        stageId: 'target-arbitrum',
        facts: [
          { kind: 'session-enabled', id: 'target-enabled', enabled: true },
        ],
        tasks: [],
        schedule: [],
      },
      results: {},
      outputs: { 'target-session': preClaimSignature },
    },
  ],
}

function requireEcdsaResult(
  result: RawSignerResult | undefined,
  taskId: string,
): Hex {
  if (result?.kind !== 'ecdsa-signature') {
    throw new Error(`Fixture task ${taskId} did not produce an ECDSA signature`)
  }
  return result.signature
}

export function assembleDualSessionIntentFixture(
  transcript: SigningTranscript,
) {
  const origin = transcript.stages.find(
    ({ stage }) => stage.stageId === 'origin-base',
  )
  if (!origin) throw new Error('Dual-session fixture has no origin stage')

  const notarized = requireEcdsaResult(
    origin.results['origin-notarized-task'],
    'origin-notarized-task',
  )
  const preClaim = requireEcdsaResult(
    origin.results['origin-pre-claim-task'],
    'origin-pre-claim-task',
  )

  return {
    origin: { notarized, preClaim },
    destination: preClaim,
    target: preClaim,
  } as const
}

export const independentMfaPlan: SigningPlan = {
  version: 1,
  kind: 'intent-independent',
  payload: { kind: 'intent', id: mfaPayloadId },
  configuredTopology: {
    rootValidatorId: 'mfa',
    validators: [
      { id: 'ownable-factor', ownerIds: ['owner-a', 'owner-b'], threshold: 2 },
      { id: 'passkey-factor', ownerIds: ['passkey-a'], threshold: 1 },
    ],
    threshold: 2,
  },
  effectiveSelection: {
    validatorIds: ['ownable-factor', 'passkey-factor'],
    signerIds: ['owner-a', 'owner-b', 'passkey-a'],
    threshold: 2,
  },
  stages: [
    {
      id: 'mfa-origin',
      checkpoint: { kind: 'none', id: 'mfa-no-read' },
      priorOutputs: [],
      taskTemplates: [
        {
          id: 'owner-a-task',
          signer: { id: 'owner-a', kind: 'ecdsa' },
          role: 'factor',
          chain: base,
          invocationKind: 'ecdsa-sign-typed-data',
          payload: { source: 'plan-payload', payloadId: mfaPayloadId },
        },
        {
          id: 'owner-b-task',
          signer: { id: 'owner-b', kind: 'ecdsa' },
          role: 'factor',
          chain: base,
          invocationKind: 'ecdsa-sign-typed-data',
          payload: { source: 'plan-payload', payloadId: mfaPayloadId },
        },
        {
          id: 'passkey-a-task',
          signer: { id: 'passkey-a', kind: 'webauthn' },
          role: 'factor',
          chain: base,
          invocationKind: 'webauthn-sign-typed-data',
          payload: { source: 'plan-payload', payloadId: mfaPayloadId },
        },
      ],
      schedule: [
        {
          id: 'mfa-factor-prompts',
          execution: 'parallel',
          taskIds: ['owner-a-task', 'owner-b-task', 'passkey-a-task'],
        },
      ],
      artifacts: [
        {
          id: 'mfa-account-signature',
          stageId: 'mfa-origin',
          usage: 'intent-origin',
          input: {
            kind: 'task-results',
            taskIds: ['owner-a-task', 'owner-b-task', 'passkey-a-task'],
          },
          validatorCodec: {
            kind: 'nested-threshold',
            validator: { kind: 'validator', address: mfaValidator },
            factorOrder: ['ownable-factor', 'passkey-factor'],
            threshold: 2,
          },
          erc7739: { kind: 'none' },
          accountEnvelope: { kind: 'nexus', validator: mfaValidator },
          erc6492: { kind: 'none' },
        },
      ],
    },
  ],
  publicOutputs: [
    {
      id: 'owner-a-contribution',
      source: { kind: 'task-result', taskId: 'owner-a-task' },
      exposedForIndependentSigning: true,
    },
    {
      id: 'owner-b-contribution',
      source: { kind: 'task-result', taskId: 'owner-b-task' },
      exposedForIndependentSigning: true,
    },
    {
      id: 'passkey-a-contribution',
      source: { kind: 'task-result', taskId: 'passkey-a-task' },
      exposedForIndependentSigning: true,
    },
  ],
}

const ownerASignature = `0x${'11'.repeat(65)}` as Hex
const ownerBSignature = `0x${'22'.repeat(65)}` as Hex
const passkeySignature = `0x${'33'.repeat(64)}` as Hex

export const independentMfaTranscript: SigningTranscript = {
  planKind: 'intent-independent',
  payloadId: mfaPayloadId,
  stages: [
    {
      stage: {
        stageId: 'mfa-origin',
        facts: [],
        tasks: independentMfaPlan.stages[0].taskTemplates.map((task) => ({
          ...task,
          invocation:
            task.signer.kind === 'webauthn'
              ? {
                  kind: 'webauthn-sign-typed-data' as const,
                  typedData: typedData(base.id, 3n),
                }
              : {
                  kind: 'ecdsa-sign-typed-data' as const,
                  chain: base,
                  typedData: typedData(base.id, 3n),
                },
        })),
        schedule: independentMfaPlan.stages[0].schedule,
      },
      results: {
        'passkey-a-task': {
          kind: 'webauthn-assertion',
          signature: passkeySignature,
          authenticatorData: `0x${'44'.repeat(37)}` as Hex,
          clientDataJSON: '{"type":"webauthn.get"}',
          challengeIndex: 23,
          typeIndex: 1,
          userVerificationRequired: false,
        },
        'owner-b-task': {
          kind: 'ecdsa-signature',
          signature: ownerBSignature,
        },
        'owner-a-task': {
          kind: 'ecdsa-signature',
          signature: ownerASignature,
        },
      },
      outputs: {},
    },
  ],
}

export function assembleIndependentMfaFixture(transcript: SigningTranscript) {
  const stage = transcript.stages.find(
    ({ stage: materialized }) => materialized.stageId === 'mfa-origin',
  )
  if (!stage) throw new Error('Independent-MFA fixture has no origin stage')

  const ownerA = requireEcdsaResult(
    stage.results['owner-a-task'],
    'owner-a-task',
  )
  const ownerB = requireEcdsaResult(
    stage.results['owner-b-task'],
    'owner-b-task',
  )
  const passkey = stage.results['passkey-a-task']
  if (passkey?.kind !== 'webauthn-assertion') {
    throw new Error('Fixture task passkey-a-task did not produce WebAuthn data')
  }

  const ownableFactor = concat([ownerA, ownerB])
  const passkeyFactor = passkey.signature
  return {
    factors: [
      {
        validatorId: 'ownable-factor',
        module: ownableValidator,
        contribution: ownableFactor,
      },
      {
        validatorId: 'passkey-factor',
        module: passkeyValidator,
        contribution: passkeyFactor,
      },
    ],
    signature: concat([ownableFactor, passkeyFactor]),
  } as const
}
