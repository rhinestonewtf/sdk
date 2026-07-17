import { encodeValidatorContribution } from '../modules/validators/contribution'
import { encodeEcdsaRecoveryValue } from '../modules/validators/ownable'
import type {
  ValidatorContributionCodec,
  ValidatorContributionInput,
} from '../modules/validators/types'
import type {
  ArtifactAssemblyPlan,
  MaterializedSigningStage,
  PlannedValidatorContributionCodec,
  RawSignerResult,
} from './types'

export function encodePlannedValidatorContribution(input: {
  readonly artifact: ArtifactAssemblyPlan
  readonly stage: MaterializedSigningStage
  readonly results: Readonly<Record<string, RawSignerResult>>
}): `0x${string}` {
  const codec = resolvePlannedValidatorCodec(
    input.artifact.validatorCodec,
    input.stage,
  )
  if (codec.kind === 'none') {
    throw new Error(`Artifact ${input.artifact.id} has no validator codec`)
  }
  if (input.artifact.input.kind !== 'task-results') {
    throw new Error(`Artifact ${input.artifact.id} does not use task results`)
  }
  const planned = input.artifact.input.taskIds.map((taskId) => {
    const task = input.stage.tasks.find(({ id }) => id === taskId)
    const result = input.results[taskId]
    if (!task || !result || !task.contribution) {
      throw new Error(`Signing contribution ${taskId} is incomplete`)
    }
    return {
      metadata: task.contribution,
      contribution: contributionFromResult(task.contribution, result),
    }
  })
  if (!input.artifact.validatorFactors) {
    return encodeValidatorContribution(
      codec,
      planned.map(({ contribution }) => contribution),
    )
  }
  const factors: ValidatorContributionInput[] =
    input.artifact.validatorFactors.map((factor) => ({
      kind: 'factor',
      factorId: factor.id,
      publicId: factor.publicId,
      validator: factor.validator,
      contribution: encodeValidatorContribution(
        factor.codec,
        planned.flatMap(({ metadata, contribution }) =>
          'factorId' in metadata && metadata.factorId === factor.id
            ? [contribution]
            : [],
        ),
      ),
    }))
  return encodeValidatorContribution(codec, factors)
}

export function resolvePlannedValidatorCodec(
  codec: PlannedValidatorContributionCodec | { readonly kind: 'none' },
  stage: MaterializedSigningStage,
): ValidatorContributionCodec | { readonly kind: 'none' } {
  if (codec.kind !== 'smart-session-state') return codec
  const fact = stage.facts.find(({ id }) => id === codec.factId)
  if (fact?.kind !== 'session-enabled') {
    throw new Error(`Session-state fact ${codec.factId} is missing`)
  }
  return fact.enabled ? codec.whenEnabled : codec.whenDisabled
}

function contributionFromResult(
  metadata: NonNullable<
    MaterializedSigningStage['tasks'][number]['contribution']
  >,
  result: RawSignerResult,
): ValidatorContributionInput {
  switch (metadata.kind) {
    case 'ecdsa':
      if (result.kind !== 'ecdsa-signature') {
        throw new Error('ECDSA task returned an incompatible result')
      }
      return {
        kind: 'ecdsa',
        ownerId: metadata.ownerId,
        signature: result.signature,
        encoding: metadata.encoding,
      }
    case 'webauthn':
      if (result.kind !== 'webauthn-assertion') {
        throw new Error('WebAuthn task returned an incompatible result')
      }
      return {
        kind: 'webauthn',
        ownerId: metadata.ownerId,
        publicKey: metadata.publicKey,
        signature: result.signature,
        authenticatorData: result.authenticatorData,
        clientDataJSON: result.clientDataJSON,
        challengeIndex: result.challengeIndex,
        typeIndex: result.typeIndex,
        userVerificationRequired: result.userVerificationRequired,
      }
    case 'session':
      if (result.kind !== 'ecdsa-signature') {
        throw new Error('Session task returned an incompatible result')
      }
      return {
        kind: 'session',
        signature: encodeEcdsaRecoveryValue(
          result.signature,
          metadata.recoveryEncoding,
        ),
      }
    case 'authorization':
      throw new Error('Authorization results are not validator contributions')
  }
}
