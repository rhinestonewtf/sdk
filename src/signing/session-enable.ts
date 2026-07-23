import {
  type Address,
  type Hex,
  hashTypedData,
  isAddressEqual,
  type TypedDataDefinition,
} from 'viem'
import type { AccountKind } from '../accounts/types'
import { toEvmChainReference } from '../chains/caip2'
import type { EvmChainReference } from '../chains/types'
import { K1_DEFAULT_VALIDATOR_ADDRESS } from '../modules/validators/k1'
import type { ValidatorContributionCodec } from '../modules/validators/types'
import type { SigningContext } from './context'
import { executeSigningPlan } from './execute'
import { createSingleStageSigningPlan } from './plan'
import { assembleTypedDataStage } from './typed-data'
import type {
  ArtifactAssemblyPlan,
  ConfiguredValidatorTopology,
  EffectiveSignerSelection,
  PayloadSigningTask,
  SigningCheckpointPort,
  SigningPayloadMaterial,
  SigningPlan,
  SigningTranscript,
} from './types'

export interface SessionEnableSigningPlanInput {
  readonly typedData: TypedDataDefinition
  readonly chain: EvmChainReference
  readonly configuredTopology: ConfiguredValidatorTopology
  readonly effectiveSelection: EffectiveSignerSelection
  readonly tasks: readonly PayloadSigningTask[]
  readonly signingMaterial?: SigningPayloadMaterial
  readonly validatorCodec: ValidatorContributionCodec
  readonly validatorFactors?: import('./types').ArtifactAssemblyPlan['validatorFactors']
  readonly route: Pick<
    ArtifactAssemblyPlan,
    'erc7739' | 'accountEnvelope' | 'erc6492'
  >
}

export function createSessionEnableSigningPlan(
  input: SessionEnableSigningPlanInput,
): SigningPlan {
  return createSingleStageSigningPlan({
    kind: 'session-enable',
    payload: { kind: 'session-enable', id: hashTypedData(input.typedData) },
    configuredTopology: input.configuredTopology,
    effectiveSelection: input.effectiveSelection,
    stageId: 'session-enable',
    chain: input.chain,
    tasks: input.tasks,
    artifacts: [
      {
        id: 'session-enable-signature',
        usage: 'session-enable',
        validatorCodec: input.validatorCodec,
        ...(input.validatorFactors
          ? { validatorFactors: input.validatorFactors }
          : {}),
        ...input.route,
      },
    ],
  })
}

export async function signSessionEnablement(input: {
  readonly planInput: SessionEnableSigningPlanInput
  readonly context: SigningContext
  readonly checkpoints: SigningCheckpointPort
}): Promise<{
  readonly signature: Hex
  readonly transcript: SigningTranscript
}> {
  const plan = createSessionEnableSigningPlan(input.planInput)
  const transcript = await executeSigningPlan({
    plan,
    payloads: {
      [plan.payload.id]: input.planInput.signingMaterial ?? {
        kind: 'typed-data',
        typedData: input.planInput.typedData,
      },
    },
    signerInvoker: input.context.signerInvoker,
    checkpoints: input.checkpoints,
    assembleStage: (stage) => assembleTypedDataStage(stage, input.context),
  })
  const signature = transcript.stages[0].outputs[
    'session-enable-signature'
  ] as Hex
  return { signature, transcript }
}

export function resolveSessionEnableChain(input: {
  readonly accountKind: AccountKind
  readonly validator: Address
  readonly hashesAndChainIds: readonly { readonly chainId: bigint }[]
  readonly defaultChain: EvmChainReference
}): EvmChainReference {
  const startaleK1 =
    input.accountKind === 'startale' &&
    isAddressEqual(input.validator, K1_DEFAULT_VALIDATOR_ADDRESS)
  if (!startaleK1) return input.defaultChain
  const chainIds = [
    ...new Set(
      input.hashesAndChainIds.map(({ chainId }) => chainId.toString()),
    ),
  ]
  if (chainIds.length > 1) {
    throw new Error(
      'Startale accounts with K1 validator do not support multi-chain session enable',
    )
  }
  const chainId = chainIds[0]
  if (chainId === undefined) {
    throw new Error('Startale K1 session enable requires one session chain')
  }
  return toEvmChainReference(Number(chainId))
}
