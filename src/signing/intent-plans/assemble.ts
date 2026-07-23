import type { Hex } from 'viem'
import type { SigningContext } from '../context'
import { encodePlannedValidatorContribution } from '../contribution'
import { runSigningStep } from '../error'
import type { SigningStageAssemblyInput } from '../execute'
import { wrapErc7739TypedDataSignature } from '../protocols/erc7739'
import type { ArtifactAssemblyPlan, SigningArtifact } from '../types'

export function assembleIntentStage(
  input: SigningStageAssemblyInput,
  context: SigningContext,
): Readonly<Record<string, SigningArtifact>> {
  const outputs: Record<string, SigningArtifact> = {}
  for (const artifact of input.stagePlan.artifacts) {
    if (artifact.input.kind === 'session-claim-pair') continue
    outputs[artifact.id] =
      artifact.input.kind === 'reuse-artifact'
        ? resolveReusedArtifact(artifact.id, artifact.input, input.priorOutputs)
        : assembleSignedArtifact(input, artifact, context)
  }
  for (const artifact of input.stagePlan.artifacts) {
    if (artifact.input.kind !== 'session-claim-pair') continue
    const preClaimSig = outputs[artifact.input.preClaimArtifactId]
    const notarizedClaimSig = outputs[artifact.input.notarizedClaimArtifactId]
    if (
      typeof preClaimSig !== 'string' ||
      typeof notarizedClaimSig !== 'string'
    ) {
      throw new Error(`Session claim pair ${artifact.id} is incomplete`)
    }
    outputs[artifact.id] = { preClaimSig, notarizedClaimSig }
  }
  return outputs
}

export function assembleIntentValidatorArtifact(input: {
  readonly artifact: ArtifactAssemblyPlan
  readonly context: SigningContext
  readonly validatorContribution: Hex
  readonly diagnostics?: {
    readonly plan: SigningStageAssemblyInput['plan']
    readonly stageId: string
  }
}): Hex {
  if (input.artifact.erc6492.kind !== 'none') {
    throw new Error('ERC-6492 is forbidden for intent signatures')
  }
  const step = <Result>(
    failureStage: Parameters<typeof runSigningStep<Result>>[0]['failureStage'],
    operation: () => Result,
  ): Result =>
    input.diagnostics
      ? runSigningStep({
          plan: input.diagnostics.plan,
          failureStage,
          stageId: input.diagnostics.stageId,
          artifactId: input.artifact.id,
          usage: input.artifact.usage,
          operation,
        })
      : operation()
  let contribution = input.validatorContribution
  const erc7739 = input.artifact.erc7739
  if (erc7739.kind === 'wrap-typed-data') {
    contribution = step('protocol-operation', () =>
      wrapErc7739TypedDataSignature({
        typedData: erc7739.typedData,
        signature: contribution,
      }),
    )
  }
  return input.artifact.accountEnvelope.kind === 'none'
    ? contribution
    : step('account-envelope', () =>
        input.context.accountAdapter.encodeSignatureEnvelope({
          account: input.context.account,
          envelope: input.artifact.accountEnvelope,
          validatorContribution: contribution,
          purpose: 'intent',
        }),
      )
}

function assembleSignedArtifact(
  input: SigningStageAssemblyInput,
  artifact: ArtifactAssemblyPlan,
  context: SigningContext,
): SigningArtifact {
  if (artifact.validatorCodec.kind === 'none') {
    if (
      artifact.input.kind !== 'task-results' ||
      artifact.input.taskIds.length !== 1
    ) {
      throw new Error(`Direct artifact ${artifact.id} requires one task`)
    }
    const result = input.results[artifact.input.taskIds[0]]
    if (result?.kind !== 'ecdsa-signature') {
      throw new Error(`Direct artifact ${artifact.id} requires an ECDSA result`)
    }
    return result.signature
  }
  return assembleIntentValidatorArtifact({
    artifact,
    context,
    validatorContribution: runSigningStep({
      plan: input.plan,
      failureStage: 'validator-encode',
      stageId: input.stage.stageId,
      artifactId: artifact.id,
      usage: artifact.usage,
      operation: () =>
        encodePlannedValidatorContribution({
          artifact,
          stage: input.stage,
          results: input.results,
        }),
    }),
    diagnostics: { plan: input.plan, stageId: input.stage.stageId },
  })
}

function resolveReusedArtifact(
  artifactId: string,
  route: Extract<
    ArtifactAssemblyPlan['input'],
    { readonly kind: 'reuse-artifact' }
  >,
  priorOutputs: Readonly<Record<string, SigningArtifact>>,
): Hex {
  const source = priorOutputs[`${route.stageId}:${route.artifactId}`]
  if (typeof source === 'string') return source
  if (source && route.selection === 'pre-claim' && 'preClaimSig' in source) {
    return source.preClaimSig
  }
  throw new Error(
    `Reused artifact ${route.artifactId} is unavailable for ${artifactId}`,
  )
}
