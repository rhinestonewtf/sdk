import type { Hex, TypedDataDefinition } from 'viem'
import { hashTypedData } from 'viem'
import type { EvmChainReference } from '../chains/types'
import type { ValidatorContributionCodec } from '../modules/validators/types'
import { encodePlannedValidatorContribution } from './contribution'
import { runSigningStep } from './error'
import { executeSigningPlan } from './execute'
import { createSingleStageSigningPlan } from './plan'
import type {
  ConfiguredValidatorTopology,
  EffectiveSignerSelection,
  PayloadSigningTask,
  SignerInvocationPort,
  SigningCheckpointPort,
  SigningPlan,
  SigningTranscript,
} from './types'

export interface SessionEnableSigningPlanInput {
  readonly typedData: TypedDataDefinition
  readonly chain: EvmChainReference
  readonly configuredTopology: ConfiguredValidatorTopology
  readonly effectiveSelection: EffectiveSignerSelection
  readonly tasks: readonly PayloadSigningTask[]
  readonly validatorCodec: ValidatorContributionCodec
  readonly validatorFactors?: import('./types').ArtifactAssemblyPlan['validatorFactors']
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
        erc7739: { kind: 'none' },
        accountEnvelope: { kind: 'none' },
        erc6492: { kind: 'none' },
      },
    ],
  })
}

export async function signSessionEnablement(input: {
  readonly planInput: SessionEnableSigningPlanInput
  readonly signerInvoker: SignerInvocationPort
  readonly checkpoints: SigningCheckpointPort
}): Promise<{
  readonly signature: Hex
  readonly transcript: SigningTranscript
}> {
  const plan = createSessionEnableSigningPlan(input.planInput)
  const transcript = await executeSigningPlan({
    plan,
    payloads: {
      [plan.payload.id]: {
        kind: 'typed-data',
        typedData: input.planInput.typedData,
      },
    },
    signerInvoker: input.signerInvoker,
    checkpoints: input.checkpoints,
    assembleStage: ({ stagePlan, stage, results }) => {
      const artifact = stagePlan.artifacts[0]
      return {
        [artifact.id]: runSigningStep({
          plan,
          failureStage: 'validator-encode',
          stageId: stage.stageId,
          artifactId: artifact.id,
          usage: artifact.usage,
          operation: () =>
            encodePlannedValidatorContribution({
              artifact,
              stage,
              results,
            }),
        }),
      }
    },
  })
  const signature = transcript.stages[0].outputs[
    'session-enable-signature'
  ] as Hex
  return { signature, transcript }
}
