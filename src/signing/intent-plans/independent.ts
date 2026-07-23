import type { Account, Address, Hex } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import {
  InsufficientOwnerSignaturesError,
  MismatchedOwnerSignaturesError,
  UnknownOwnerError,
} from '../../errors/execution'
import { encodeValidatorContribution } from '../../modules/validators/contribution'
import { encodeValidatorId } from '../../modules/validators/multi-factor'
import type {
  ValidatorContributionCodec,
  ValidatorContributionInput,
} from '../../modules/validators/types'
import type { SigningContext } from '../context'
import type { ArtifactAssemblyPlan } from '../types'
import { assembleIntentValidatorArtifact } from './assemble'

export interface IndependentOwnerDescriptor {
  readonly ownerId: string
  readonly identity: Address | Hex
  readonly kind: 'ecdsa' | 'webauthn'
  readonly factorId?: string
  readonly factorPublicId?: number | Hex
}

export type IndependentOwnerSignatureData =
  | {
      readonly kind: 'ecdsa'
      readonly signer: Address
      readonly origin: readonly Hex[]
    }
  | {
      readonly kind: 'passkey'
      readonly publicKey: Hex
      readonly origin: readonly {
        readonly webauthn: {
          readonly authenticatorData: Hex
          readonly challengeIndex?: number
          readonly clientDataJSON: string
          readonly typeIndex?: number
          readonly userVerificationRequired?: boolean
        }
        readonly signature: Hex
      }[]
    }

export type IndependentOwnerSignature =
  | ({ readonly intentId: string } & IndependentOwnerSignatureData)
  | {
      readonly intentId: string
      readonly kind: 'multi-factor'
      readonly validatorId: number | Hex
      readonly signature: IndependentOwnerSignatureData
    }

export function assembleIndependentIntentArtifact(input: {
  readonly intentId: string
  readonly originIndex: number
  readonly originCount: number
  readonly signatures: readonly IndependentOwnerSignature[]
  readonly owners: readonly IndependentOwnerDescriptor[]
  readonly artifact: ArtifactAssemblyPlan
  readonly context: SigningContext
}): Hex {
  if (input.artifact.validatorCodec.kind === 'none') {
    throw new Error('Independent signing requires a validator codec')
  }
  if (input.artifact.validatorCodec.kind === 'smart-session-state') {
    throw new Error('Smart Session state cannot be signed independently')
  }
  const contributions = importOwnerContributions(input)
  const codec = input.artifact.validatorCodec
  if (codec.kind === 'smart-session') {
    throw new Error('Smart Session state cannot be signed independently')
  }
  const validatorContribution = input.artifact.validatorFactors
    ? encodeIndependentFactors(
        codec,
        input.artifact.validatorFactors,
        contributions,
      )
    : encodeAtomicContributions(
        codec,
        contributions.map(({ contribution }) => contribution),
      )
  return assembleIntentValidatorArtifact({
    artifact: input.artifact,
    context: input.context,
    validatorContribution,
  })
}

function importOwnerContributions(input: {
  readonly intentId: string
  readonly originIndex: number
  readonly originCount: number
  readonly signatures: readonly IndependentOwnerSignature[]
  readonly owners: readonly IndependentOwnerDescriptor[]
}): readonly {
  readonly factorId?: string
  readonly contribution: ValidatorContributionInput
}[] {
  const seen = new Set<string>()
  return input.signatures.map((value) => {
    if (value.intentId !== input.intentId) {
      throw new MismatchedOwnerSignaturesError({
        context: { intentIds: [input.intentId, value.intentId] },
      })
    }
    const signature = value.kind === 'multi-factor' ? value.signature : value
    if (signature.origin.length !== input.originCount) {
      throw new MismatchedOwnerSignaturesError({
        context: { expectedOriginCount: input.originCount },
      })
    }
    const identity =
      signature.kind === 'ecdsa'
        ? signature.signer.toLowerCase()
        : signature.publicKey.toLowerCase()
    const owner = input.owners.find(
      (candidate) =>
        candidate.identity.toLowerCase() === identity &&
        (value.kind === 'multi-factor'
          ? candidate.factorPublicId !== undefined &&
            sameValidatorId(candidate.factorPublicId, value.validatorId)
          : candidate.factorId === undefined),
    )
    if (!owner) {
      const matchingIdentity = input.owners.filter(
        (candidate) => candidate.identity.toLowerCase() === identity,
      )
      if (
        matchingIdentity.length > 0 &&
        (value.kind === 'multi-factor' ||
          matchingIdentity.some(({ factorId }) => factorId !== undefined))
      ) {
        throw new MismatchedOwnerSignaturesError({
          context:
            value.kind === 'multi-factor'
              ? { validatorId: value.validatorId }
              : { expectedKind: 'multi-factor' },
        })
      }
      throw new UnknownOwnerError({
        context:
          signature.kind === 'passkey'
            ? { publicKey: signature.publicKey }
            : { signer: signature.signer },
      })
    }
    const contributionKey = `${owner.factorId ?? 'root'}:${identity}`
    if (seen.has(contributionKey))
      throw new MismatchedOwnerSignaturesError({
        context: { duplicateOwner: identity },
      })
    seen.add(contributionKey)
    if (
      (signature.kind === 'ecdsa' && owner.kind !== 'ecdsa') ||
      (signature.kind === 'passkey' && owner.kind !== 'webauthn')
    ) {
      throw new MismatchedOwnerSignaturesError({
        context: { owner: identity },
      })
    }
    const contribution: ValidatorContributionInput =
      signature.kind === 'ecdsa'
        ? {
            kind: 'ecdsa',
            ownerId: owner.ownerId,
            signature: signature.origin[input.originIndex],
            encoding: 'validator-contribution',
          }
        : {
            kind: 'webauthn',
            ownerId: owner.ownerId,
            publicKey: signature.publicKey,
            signature: signature.origin[input.originIndex].signature,
            authenticatorData:
              signature.origin[input.originIndex].webauthn.authenticatorData,
            clientDataJSON:
              signature.origin[input.originIndex].webauthn.clientDataJSON,
            challengeIndex:
              signature.origin[input.originIndex].webauthn.challengeIndex ?? 0,
            typeIndex:
              signature.origin[input.originIndex].webauthn.typeIndex ?? 0,
            userVerificationRequired:
              signature.origin[input.originIndex].webauthn
                .userVerificationRequired ?? false,
          }
    return {
      ...(owner.factorId ? { factorId: owner.factorId } : {}),
      contribution,
    }
  })
}

function sameValidatorId(left: number | Hex, right: number | Hex): boolean {
  try {
    return (
      encodeValidatorId(left).toLowerCase() ===
      encodeValidatorId(right).toLowerCase()
    )
  } catch {
    return false
  }
}

function encodeIndependentFactors(
  codec: Exclude<
    ValidatorContributionCodec,
    { readonly kind: 'smart-session' }
  >,
  factors: NonNullable<ArtifactAssemblyPlan['validatorFactors']>,
  contributions: readonly {
    readonly factorId?: string
    readonly contribution: ValidatorContributionInput
  }[],
): Hex {
  const factorContributions: ValidatorContributionInput[] = factors.flatMap(
    (factor) => {
      const selected = contributions.flatMap((entry) =>
        entry.factorId === factor.id ? [entry.contribution] : [],
      )
      if (selected.length === 0) return []
      if (selected.length < factor.codec.threshold) {
        throw new InsufficientOwnerSignaturesError({
          required: factor.codec.threshold,
          provided: selected.length,
          validatorId: factor.publicId,
        })
      }
      return [
        {
          kind: 'factor',
          factorId: factor.id,
          publicId: factor.publicId,
          validator: factor.validator,
          contribution: encodeValidatorContribution(factor.codec, selected),
        },
      ]
    },
  )
  if (factorContributions.length < codec.threshold) {
    throw new InsufficientOwnerSignaturesError({
      required: codec.threshold,
      provided: factorContributions.length,
    })
  }
  return encodeValidatorContribution(codec, factorContributions)
}

function encodeAtomicContributions(
  codec: Exclude<
    ValidatorContributionCodec,
    { readonly kind: 'smart-session' }
  >,
  contributions: readonly ValidatorContributionInput[],
): Hex {
  if (
    codec.kind === 'ordered-threshold' &&
    contributions.length < codec.threshold
  ) {
    throw new InsufficientOwnerSignaturesError({
      required: codec.threshold,
      provided: contributions.length,
    })
  }
  return encodeValidatorContribution(codec, contributions)
}

export type IndependentSigner = Account | WebAuthnAccount
