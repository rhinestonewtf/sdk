import { type Hex, hashTypedData, type TypedDataDefinition } from 'viem'
import { EoaSigningNotSupportedError } from '../accounts/error'
import type { EvmChainReference } from '../chains/types'
import type { SigningContext } from './context'
import { encodePlannedValidatorContribution } from './contribution'
import { runSigningStep } from './error'
import { executeSigningPlan, type SigningStageAssemblyInput } from './execute'
import { createSingleStageSigningPlan } from './plan'
import { wrapErc6492Signature } from './protocols/erc6492'
import { wrapErc7739TypedDataSignature } from './protocols/erc7739'
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

export interface TypedDataSigningPlanInput {
  readonly typedData: TypedDataDefinition
  readonly signingMaterial?: SigningPayloadMaterial
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

export function createTypedDataSigningPlan(
  input: TypedDataSigningPlanInput,
): SigningPlan {
  return createSingleStageSigningPlan({
    kind: 'account-typed-data',
    payload: { kind: 'typed-data', id: hashTypedData(input.typedData) },
    configuredTopology: input.configuredTopology,
    effectiveSelection: input.effectiveSelection,
    stageId: 'typed-data',
    ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
    chain: input.chain,
    tasks: input.tasks,
    artifacts: [
      {
        id: 'typed-data-signature',
        usage: 'erc1271',
        ...input.route,
      },
    ],
  })
}

export async function signAccountTypedData(input: {
  readonly planInput: TypedDataSigningPlanInput
  readonly context: SigningContext
  readonly checkpoints: SigningCheckpointPort
}): Promise<{
  readonly signature: Hex
  readonly transcript: SigningTranscript
}> {
  if (input.context.account.definition.kind === 'eoa') {
    throw new EoaSigningNotSupportedError('packed signatures')
  }
  const plan = createTypedDataSigningPlan(input.planInput)
  const transcript = await executeSigningPlan({
    plan,
    payloads: {
      [plan.payload.id]: input.planInput.signingMaterial ?? {
        kind: 'typed-data',
        typedData: input.planInput.typedData,
      },
    },
    checkpoints: input.checkpoints,
    signerInvoker: input.context.signerInvoker,
    assembleStage: (stage) => assembleTypedDataStage(stage, input.context),
  })
  const signature = transcript.stages[0].outputs['typed-data-signature'] as Hex
  return { signature, transcript }
}

function assembleTypedDataStage(
  input: SigningStageAssemblyInput,
  context: SigningContext,
): Readonly<Record<string, Hex>> {
  const artifact = input.stagePlan.artifacts[0]
  if (!artifact) throw new Error('Typed-data plan has no artifact')
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
  let contribution = step('validator-encode', () =>
    encodePlannedValidatorContribution({
      artifact,
      stage: input.stage,
      results: input.results,
    }),
  )
  const erc7739 = artifact.erc7739
  if (erc7739.kind === 'wrap-typed-data') {
    contribution = step('protocol-operation', () =>
      wrapErc7739TypedDataSignature({
        typedData: erc7739.typedData,
        signature: contribution,
      }),
    )
  }
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
