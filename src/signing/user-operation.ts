import type { Hex } from 'viem'
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

export interface UserOperationSigningPlanInput {
  readonly hash: Hex
  readonly chain: EvmChainReference
  readonly configuredTopology: ConfiguredValidatorTopology
  readonly effectiveSelection: EffectiveSignerSelection
  readonly tasks: readonly PayloadSigningTask[]
  readonly validatorCodec: ValidatorContributionCodec
  readonly validatorFactors?: import('./types').ArtifactAssemblyPlan['validatorFactors']
}

export function createUserOperationSigningPlan(
  input: UserOperationSigningPlanInput,
): SigningPlan {
  return createSingleStageSigningPlan({
    kind: 'user-operation',
    payload: { kind: 'user-operation', id: input.hash },
    configuredTopology: input.configuredTopology,
    effectiveSelection: input.effectiveSelection,
    stageId: 'user-operation',
    chain: input.chain,
    tasks: input.tasks,
    artifacts: [
      {
        id: 'user-operation-signature',
        usage: 'user-operation',
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

export async function signUserOperationPayload(input: {
  readonly planInput: UserOperationSigningPlanInput
  readonly signerInvoker: SignerInvocationPort
  readonly checkpoints: SigningCheckpointPort
}): Promise<{
  readonly signature: Hex
  readonly transcript: SigningTranscript
}> {
  const plan = createUserOperationSigningPlan(input.planInput)
  const transcript = await executeSigningPlan({
    plan,
    payloads: {
      [plan.payload.id]: {
        kind: 'message',
        message: { raw: input.planInput.hash },
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
    'user-operation-signature'
  ] as Hex
  return { signature, transcript }
}
