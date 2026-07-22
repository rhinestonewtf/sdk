import { concat, type Hex, hashTypedData, type TypedDataDefinition } from 'viem'
import { wrapKernelMessageHash } from '../accounts/adapters/kernel'
import {
  K1_DEFAULT_VALIDATOR_ADDRESS,
  startaleEip712Domain,
} from '../accounts/adapters/startale'
import { EoaSigningNotSupportedError } from '../accounts/error'
import type { EvmChainReference } from '../chains/types'
import type { SigningContext } from './context'
import { encodePlannedValidatorContribution } from './contribution'
import { runSigningStep } from './error'
import { executeSigningPlan, type SigningStageAssemblyInput } from './execute'
import { createSingleStageSigningPlan } from './plan'
import { wrapErc6492Signature } from './protocols/erc6492'
import {
  hashErc7739TypedData,
  wrapErc7739TypedDataSignature,
} from './protocols/erc7739'
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

export function resolveAccountTypedDataSigning(input: {
  readonly typedData: TypedDataDefinition
  readonly chain: EvmChainReference
  readonly context: SigningContext
}): {
  readonly material: SigningPayloadMaterial
  readonly payloadKind: 'message' | 'typed-data'
  readonly ecdsaInvocation: 'ecdsa-sign-message' | 'ecdsa-sign-typed-data'
  readonly webauthnInvocation: 'webauthn-sign-hash' | 'webauthn-sign-typed-data'
  readonly erc7739: ArtifactAssemblyPlan['erc7739']
} {
  const payload = hashTypedData(input.typedData)
  const accountKind = input.context.account.definition.kind
  const startaleK1 =
    accountKind === 'startale' &&
    input.context.validatorCapabilities.compatibilityKey.moduleAddress.toLowerCase() ===
      K1_DEFAULT_VALIDATOR_ADDRESS.toLowerCase()
  const messagePayload =
    accountKind === 'kernel'
      ? wrapKernelMessageHash(payload, input.context.account.address)
      : startaleK1
        ? hashErc7739TypedData({
            typedData: input.typedData,
            verifierDomain: startaleEip712Domain(
              input.context.account.address,
              input.chain.id,
            ),
          })
        : input.context.validatorCapabilities.supportsEip712
          ? undefined
          : payload
  return messagePayload
    ? {
        material: { kind: 'message', message: { raw: messagePayload } },
        payloadKind: 'message',
        ecdsaInvocation: 'ecdsa-sign-message',
        webauthnInvocation: 'webauthn-sign-hash',
        erc7739: startaleK1
          ? { kind: 'wrap-typed-data', typedData: input.typedData }
          : { kind: 'none' },
      }
    : {
        material: { kind: 'typed-data', typedData: input.typedData },
        payloadKind: 'typed-data',
        ecdsaInvocation: 'ecdsa-sign-typed-data',
        webauthnInvocation: 'webauthn-sign-typed-data',
        erc7739: { kind: 'none' },
      }
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

export function assembleTypedDataStage(
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
  if (erc7739.kind !== 'none') {
    contribution = step('protocol-operation', () => {
      const wrapped = wrapErc7739TypedDataSignature({
        typedData: erc7739.typedData,
        signature: contribution,
      })
      return erc7739.kind === 'wrap-session-typed-data'
        ? concat([erc7739.permissionId, wrapped])
        : wrapped
    })
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
