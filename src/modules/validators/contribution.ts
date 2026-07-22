import type { Hex } from 'viem'
import { encodeMultiFactorContribution } from './multi-factor'
import { encodeEcdsaValidatorContribution } from './ownable'
import { encodeSmartSessionContribution } from './smart-sessions/signature'
import type {
  ValidatorContributionCodec,
  ValidatorContributionInput,
} from './types'
import { encodeWebauthnValidatorContribution } from './webauthn'

export function encodeValidatorContribution(
  codec: ValidatorContributionCodec,
  contributions: readonly ValidatorContributionInput[],
): Hex {
  switch (codec.kind) {
    case 'ordered-threshold': {
      const ecdsa = contributions.filter(
        (contribution) => contribution.kind === 'ecdsa',
      )
      const webauthn = contributions.filter(
        (contribution) => contribution.kind === 'webauthn',
      )
      if (ecdsa.length > 0 && webauthn.length > 0) {
        throw new Error('Atomic validators cannot mix signer result kinds')
      }
      if (webauthn.length > 0) {
        if (!codec.webauthn) {
          throw new Error('WebAuthn contribution codec context is missing')
        }
        return encodeWebauthnValidatorContribution({
          ownerOrder: codec.ownerOrder,
          threshold: codec.threshold,
          ...codec.webauthn,
          contributions: webauthn,
        })
      }
      if (ecdsa.length !== contributions.length) {
        throw new Error('Ordered validator received an incompatible result')
      }
      return encodeEcdsaValidatorContribution({
        ownerOrder: codec.ownerOrder,
        threshold: codec.threshold,
        recoveryEncoding: codec.recoveryEncoding,
        contributions: ecdsa,
      })
    }
    case 'nested-threshold': {
      const factors = contributions.filter(
        (contribution) => contribution.kind === 'factor',
      )
      if (factors.length !== contributions.length) {
        throw new Error('Nested validator received a non-factor contribution')
      }
      return encodeMultiFactorContribution({
        factorOrder: codec.factorOrder,
        threshold: codec.threshold,
        contributions: factors,
      })
    }
    case 'smart-session': {
      const signature = codec.signerCodec
        ? encodeValidatorContribution(codec.signerCodec, contributions)
        : contributions.length === 1 && contributions[0]?.kind === 'session'
          ? contributions[0].signature
          : undefined
      if (!signature) throw new Error('Smart Session signer result is missing')
      return encodeSmartSessionContribution({
        mode: codec.mode,
        permissionId: codec.permissionId,
        signature,
        ...(codec.claimPolicyData
          ? { claimPolicyData: codec.claimPolicyData }
          : {}),
        ...(codec.enableData ? { enableData: codec.enableData } : {}),
      })
    }
  }
}
