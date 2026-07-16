import type { Account, Address, Hex } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
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
  const validatorContribution = input.artifact.validatorFactors
    ? encodeIndependentFactors(
        input.artifact.validatorCodec,
        input.artifact.validatorFactors,
        contributions,
      )
    : encodeValidatorContribution(
        input.artifact.validatorCodec,
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
  const owners = new Map(
    input.owners.map((owner) => [owner.identity.toLowerCase(), owner]),
  )
  const seen = new Set<string>()
  return input.signatures.map((value) => {
    if (value.intentId !== input.intentId) {
      throw new Error('Owner signature belongs to another intent')
    }
    const signature = value.kind === 'multi-factor' ? value.signature : value
    if (signature.origin.length !== input.originCount) {
      throw new Error('Owner signature has an incompatible origin count')
    }
    const identity =
      signature.kind === 'ecdsa'
        ? signature.signer.toLowerCase()
        : signature.publicKey.toLowerCase()
    const owner = owners.get(identity)
    if (!owner) throw new Error(`Unknown independent owner ${identity}`)
    if (seen.has(identity))
      throw new Error(`Duplicate independent owner ${identity}`)
    seen.add(identity)
    if (
      (signature.kind === 'ecdsa' && owner.kind !== 'ecdsa') ||
      (signature.kind === 'passkey' && owner.kind !== 'webauthn')
    ) {
      throw new Error('Owner signature kind does not match its validator')
    }
    if (value.kind === 'multi-factor') {
      if (
        owner.factorId === undefined ||
        owner.factorPublicId === undefined ||
        encodeValidatorId(value.validatorId).toLowerCase() !==
          encodeValidatorId(owner.factorPublicId).toLowerCase()
      ) {
        throw new Error('Owner signature has an incompatible validator id')
      }
    } else if (owner.factorId !== undefined) {
      throw new Error(
        'Multi-factor owner signature is missing its validator id',
      )
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

function encodeIndependentFactors(
  codec: ValidatorContributionCodec,
  factors: NonNullable<ArtifactAssemblyPlan['validatorFactors']>,
  contributions: readonly {
    readonly factorId?: string
    readonly contribution: ValidatorContributionInput
  }[],
): Hex {
  const factorContributions: ValidatorContributionInput[] = factors.map(
    (factor) => ({
      kind: 'factor',
      factorId: factor.id,
      publicId: factor.publicId,
      validator: factor.validator,
      contribution: encodeValidatorContribution(
        factor.codec,
        contributions.flatMap((entry) =>
          entry.factorId === factor.id ? [entry.contribution] : [],
        ),
      ),
    }),
  )
  return encodeValidatorContribution(codec, factorContributions)
}

export type IndependentSigner = Account | WebAuthnAccount
