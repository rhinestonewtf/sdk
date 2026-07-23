import { type Hex, hashMessage, type SignableMessage } from 'viem'
import { EoaSigningNotSupportedError } from '../accounts/error'
import type { EvmChainReference } from '../chains/types'
import type { SigningContext } from './context'
import { encodePlannedValidatorContribution } from './contribution'
import { runSigningStep } from './error'
import { executeSigningPlan, type SigningStageAssemblyInput } from './execute'
import { createSingleStageSigningPlan } from './plan'
import { wrapErc6492Signature } from './protocols/erc6492'
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

export interface MessageSigningPlanInput {
  readonly message: SignableMessage
  readonly signingMaterial?: Extract<
    SigningPayloadMaterial,
    { readonly kind: 'message' }
  >
  readonly chain: EvmChainReference
  readonly configuredTopology: ConfiguredValidatorTopology
  readonly effectiveSelection: EffectiveSignerSelection
  readonly tasks: readonly PayloadSigningTask[]
  readonly route: Omit<
    ArtifactAssemblyPlan,
    'id' | 'stageId' | 'input' | 'usage'
  >
  readonly checkpoint?: Extract<
    import('./types').SigningReadCheckpoint,
    { readonly kind: 'account-deployment' }
  >
}

export function createMessageSigningPlan(
  input: MessageSigningPlanInput,
): SigningPlan {
  return createSingleStageSigningPlan({
    kind: 'account-message',
    payload: { kind: 'message', id: hashMessage(input.message) },
    configuredTopology: input.configuredTopology,
    effectiveSelection: input.effectiveSelection,
    stageId: 'message',
    ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
    chain: input.chain,
    tasks: input.tasks,
    artifacts: [
      {
        id: 'message-signature',
        usage: 'erc1271',
        ...input.route,
      },
    ],
  })
}

export async function signAccountMessage(input: {
  readonly planInput: MessageSigningPlanInput
  readonly context: SigningContext
  readonly checkpoints: SigningCheckpointPort
}): Promise<{
  readonly signature: Hex
  readonly transcript: SigningTranscript
}> {
  if (input.context.account.definition.kind === 'eoa') {
    throw new EoaSigningNotSupportedError('packed signatures')
  }
  const plan = createMessageSigningPlan(input.planInput)
  const transcript = await executeSigningPlan({
    plan,
    payloads: {
      [plan.payload.id]: {
        kind: 'message',
        message:
          input.planInput.signingMaterial?.message ??
          ({ raw: plan.payload.id } as const),
      },
    },
    checkpoints: input.checkpoints,
    signerInvoker: input.context.signerInvoker,
    assembleStage: (stage) => assembleMessageStage(stage, input.context),
  })
  const signature = transcript.stages[0].outputs['message-signature'] as Hex
  return { signature, transcript }
}

function assembleMessageStage(
  input: SigningStageAssemblyInput,
  context: SigningContext,
): Readonly<Record<string, Hex>> {
  const artifact = input.stagePlan.artifacts[0]
  if (!artifact) throw new Error('Message plan has no artifact')
  if (artifact.erc7739.kind !== 'none') {
    throw new Error('ERC-7739 is not a message-signing operation')
  }
  const step = <Result>(
    failureStage: Parameters<typeof runSigningStep<Result>>[0]['failureStage'],
    operation: () => Result,
  ) =>
    runSigningStep({
      plan: input.plan,
      failureStage,
      stageId: input.stage.stageId,
      artifactId: artifact.id,
      usage: artifact.usage,
      operation,
    })
  const contribution = step('validator-encode', () =>
    encodePlannedValidatorContribution({
      artifact,
      stage: input.stage,
      results: input.results,
    }),
  )
  const accountSignature =
    artifact.accountEnvelope.kind === 'none'
      ? contribution
      : step('account-envelope', () =>
          context.accountAdapter.encodeSignatureEnvelope({
            account: context.account,
            envelope: artifact.accountEnvelope,
            validatorContribution: contribution,
            purpose: 'erc1271',
          }),
        )
  const erc6492 = artifact.erc6492
  if (erc6492.kind === 'none') {
    return { [artifact.id]: accountSignature }
  }
  const deployed = input.stage.facts.find(
    (fact) => fact.kind === 'account-deployed',
  )
  return {
    [artifact.id]:
      deployed?.kind === 'account-deployed' && deployed.deployed
        ? accountSignature
        : step('protocol-operation', () =>
            wrapErc6492Signature({
              factory: erc6492.factory,
              factoryData: erc6492.factoryData,
              signature: accountSignature,
            }),
          ),
  }
}
