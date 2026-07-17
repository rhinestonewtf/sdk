import {
  type Address,
  encodeAbiParameters,
  type Hex,
  hashTypedData,
  keccak256,
  type SignedAuthorization,
  type TypedDataDefinition,
} from 'viem'
import type { ChainReference, EvmChainReference } from '../chains/types'
import { executeSigningPlan } from './execute'
import type {
  ConfiguredValidatorTopology,
  EffectiveSignerSelection,
  PayloadSigningTask,
  SignerInvocationPort,
  SignerReference,
  SigningCheckpointPort,
  SigningPayloadRegistry,
  SigningPlan,
  SigningTranscript,
} from './types'

export interface NexusEip7702InitPlanInput {
  readonly typedData: TypedDataDefinition
  readonly chain: EvmChainReference
  readonly signer: SignerReference
}

export function createNexusEip7702InitTypedData(input: {
  readonly contract: Address
  readonly initData: Hex
}): TypedDataDefinition {
  return {
    domain: { name: 'Nexus', version: '1.2.0' },
    types: {
      Initialize: [
        { name: 'nexus', type: 'address' },
        { name: 'chainIds', type: 'uint256[]' },
        { name: 'initData', type: 'bytes' },
      ],
    },
    primaryType: 'Initialize',
    message: {
      nexus: input.contract,
      chainIds: [0n],
      initData: input.initData,
    },
  }
}

export function createNexusEip7702InitPlan(
  input: NexusEip7702InitPlanInput,
): SigningPlan {
  const payloadId = hashTypedData(input.typedData)
  return directSigningPlan({
    kind: 'nexus-eip7702-init',
    payload: { kind: 'typed-data', id: payloadId },
    stageId: 'nexus-eip7702-init',
    task: {
      id: 'nexus-eip7702-init-signer',
      signer: input.signer,
      role: 'owner',
      invocationKind: 'ecdsa-sign-typed-data',
      payload: { source: 'plan-payload', payloadId },
      chain: input.chain,
    },
    artifactId: 'nexus-eip7702-init-signature',
  })
}

export async function signNexusEip7702Init(input: {
  readonly planInput: NexusEip7702InitPlanInput
  readonly signerInvoker: SignerInvocationPort
  readonly checkpoints: SigningCheckpointPort
}): Promise<{
  readonly signature: Hex
  readonly transcript: SigningTranscript
}> {
  const plan = createNexusEip7702InitPlan(input.planInput)
  const transcript = await executeDirectPlan({
    plan,
    payloads: {
      [plan.payload.id]: {
        kind: 'typed-data',
        typedData: input.planInput.typedData,
      },
    },
    signerInvoker: input.signerInvoker,
    checkpoints: input.checkpoints,
    artifactId: 'nexus-eip7702-init-signature',
  })
  const signature = transcript.stages[0].outputs[
    'nexus-eip7702-init-signature'
  ] as Hex
  return { signature, transcript }
}

export interface AuthorizationListPlanInput {
  readonly account: Address
  readonly contract: Address
  readonly chains: readonly ChainReference[]
  readonly signer: SignerReference
  readonly nonceByChain: Readonly<Record<number, number>>
}

export function createAuthorizationListPlan(
  input: AuthorizationListPlanInput,
): { readonly plan: SigningPlan; readonly payloads: SigningPayloadRegistry } {
  const chains = dedupeEvmChains(input.chains)
  const payloadId = keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256[]' }],
      [input.contract, chains.map(({ id }) => BigInt(id))],
    ),
  )
  const payloads: Record<Hex, SigningPayloadRegistry[Hex]> = {}
  const stages = chains.map((chain) => {
    const nonce = input.nonceByChain[chain.id]
    if (nonce === undefined) {
      throw new Error(`Authorization nonce for chain ${chain.id} is missing`)
    }
    const chainPayloadId = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'uint256' }],
        [payloadId, BigInt(chain.id)],
      ),
    )
    payloads[chainPayloadId] = {
      kind: 'authorization',
      authorization: {
        contractAddress: input.contract,
        chainId: chain.id,
        nonce,
      },
    }
    const taskId = `authorization-${chain.id}`
    const factId = `delegation-${chain.id}`
    return {
      id: `authorization-chain-${chain.id}`,
      checkpoint: {
        kind: 'delegation-code' as const,
        id: factId,
        chain,
        account: input.account,
      },
      priorOutputs: [],
      taskTemplates: [
        {
          id: taskId,
          signer: input.signer,
          role: 'authorization' as const,
          chain,
          invocationKind: 'sign-authorization' as const,
          payload: {
            source: 'plan-payload' as const,
            payloadId: chainPayloadId,
          },
          when: {
            kind: 'delegation-required' as const,
            factId,
            contract: input.contract,
          },
          contribution: { kind: 'authorization' as const },
        },
      ],
      schedule: [
        {
          id: `authorization-prompt-${chain.id}`,
          execution: 'serial' as const,
          taskIds: [taskId],
        },
      ],
      artifacts: [],
    }
  })
  const plan: SigningPlan = {
    version: 1,
    kind: 'eip7702-authorization-list',
    payload: { kind: 'authorization', id: payloadId },
    configuredTopology: emptyTopology,
    effectiveSelection: emptySelection,
    stages,
    publicOutputs: stages.map((stage) => ({
      id: `${stage.id}-result`,
      source: { kind: 'task-result', taskId: stage.taskTemplates[0].id },
      exposedForIndependentSigning: false,
    })),
  }
  return { plan, payloads }
}

export async function signAuthorizationList(input: {
  readonly planInput: AuthorizationListPlanInput
  readonly signerInvoker: SignerInvocationPort
  readonly checkpoints: SigningCheckpointPort
}): Promise<{
  readonly authorizations: readonly SignedAuthorization[]
  readonly transcript: SigningTranscript
}> {
  const { plan, payloads } = createAuthorizationListPlan(input.planInput)
  const transcript = await executeSigningPlan({
    plan,
    payloads,
    signerInvoker: input.signerInvoker,
    checkpoints: input.checkpoints,
    assembleStage: () => ({}),
  })
  const authorizations = transcript.stages.flatMap(({ results }) =>
    Object.values(results).flatMap((result) =>
      result.kind === 'signed-authorization' ? [result.authorization] : [],
    ),
  )
  return { authorizations, transcript }
}

function directSigningPlan(input: {
  readonly kind: SigningPlan['kind']
  readonly payload: SigningPlan['payload']
  readonly stageId: string
  readonly task: SigningPlan['stages'][number]['taskTemplates'][number]
  readonly artifactId: string
}): SigningPlan {
  return {
    version: 1,
    kind: input.kind,
    payload: input.payload,
    configuredTopology: emptyTopology,
    effectiveSelection: emptySelection,
    stages: [
      {
        id: input.stageId,
        checkpoint: { kind: 'none', id: `${input.stageId}-no-read` },
        priorOutputs: [],
        taskTemplates: [input.task],
        schedule: [
          {
            id: `${input.stageId}-signer`,
            execution: 'serial',
            taskIds: [input.task.id],
          },
        ],
        artifacts: [
          {
            id: input.artifactId,
            stageId: input.stageId,
            usage: 'erc1271',
            input: { kind: 'task-results', taskIds: [input.task.id] },
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
        id: input.artifactId,
        source: { kind: 'artifact', artifactId: input.artifactId },
        exposedForIndependentSigning: false,
      },
    ],
  }
}

async function executeDirectPlan(input: {
  readonly plan: SigningPlan
  readonly payloads: SigningPayloadRegistry
  readonly signerInvoker: SignerInvocationPort
  readonly checkpoints: SigningCheckpointPort
  readonly artifactId: string
}): Promise<SigningTranscript> {
  return executeSigningPlan({
    plan: input.plan,
    payloads: input.payloads,
    signerInvoker: input.signerInvoker,
    checkpoints: input.checkpoints,
    assembleStage: ({ results }) => {
      const result = Object.values(results)[0]
      if (result?.kind !== 'ecdsa-signature') {
        throw new Error('Direct signing task did not return an ECDSA signature')
      }
      return { [input.artifactId]: result.signature }
    },
  })
}

function dedupeEvmChains(
  chains: readonly ChainReference[],
): readonly EvmChainReference[] {
  const seen = new Set<number>()
  return chains.flatMap((chain) => {
    if (chain.kind !== 'evm' || seen.has(chain.id)) return []
    seen.add(chain.id)
    return [chain]
  })
}

const emptyTopology: ConfiguredValidatorTopology = {
  rootValidatorId: 'none',
  validators: [],
  threshold: 0,
}

const emptySelection: EffectiveSignerSelection = {
  validatorIds: [],
  signerIds: [],
  threshold: 0,
}

export type { PayloadSigningTask }
