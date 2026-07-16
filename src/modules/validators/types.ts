import type { Account, Address, Hex } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { ModuleId } from '../types'
import type { SmartSessionEnableContributionData } from './smart-session-signature-types'

export type ValidatorKind =
  | 'ecdsa'
  | 'ens'
  | 'passkey'
  | 'multi-factor'
  | 'k1'
  | 'smart-session'

export type ValidatorPayloadKind =
  | 'message'
  | 'typed-data'
  | 'intent'
  | 'user-operation'
  | 'session-enable'

export type ValidatorSigningPurpose =
  | 'erc1271'
  | 'intent'
  | 'user-operation'
  | 'session-enable'

export type AtomicValidatorInput =
  | {
      type: 'ecdsa'
      accounts: Account[]
      threshold?: number
      module?: Address
    }
  | {
      type: 'ens'
      owners: { account: Account; expiration?: Date }[]
      threshold?: number
    }
  | {
      type: 'passkey'
      accounts: WebAuthnAccount[]
      threshold?: number
      module?: Address
    }

export interface MultiFactorValidatorInput {
  type: 'multi-factor'
  validators: AtomicValidatorInput[]
  threshold?: number
  module?: Address
}

export type ValidatorInput = AtomicValidatorInput | MultiFactorValidatorInput

export type ValidatorModuleSelection =
  | { readonly source: 'explicit'; readonly address: Address }
  | {
      readonly source: 'default'
      readonly profile: 'ownable' | 'ens' | 'webauthn' | 'multi-factor'
    }

export type ValidatorOwner =
  | {
      readonly kind: 'ecdsa' | 'ens'
      readonly id: string
      readonly signerId: string
      readonly account: Account
      readonly expiration?: Date
    }
  | {
      readonly kind: 'webauthn'
      readonly id: string
      readonly signerId: string
      readonly account: WebAuthnAccount
    }

export interface AtomicValidatorDefinition {
  readonly kind: Exclude<ValidatorKind, 'multi-factor'>
  readonly id: string
  readonly publicId: number | Hex
  readonly module: ValidatorModuleSelection
  readonly owners: readonly ValidatorOwner[]
  readonly threshold: number
}

export interface MultiFactorValidatorDefinition {
  readonly kind: 'multi-factor'
  readonly id: string
  readonly publicId: number | Hex
  readonly module: ValidatorModuleSelection
  readonly validators: readonly AtomicValidatorDefinition[]
  readonly threshold: number
}

export type ResolvedValidatorDefinition =
  | AtomicValidatorDefinition
  | MultiFactorValidatorDefinition

export type ValidatorContributionCodec =
  | {
      readonly kind: 'ordered-threshold'
      readonly validator: ModuleId
      readonly ownerOrder: readonly string[]
      readonly threshold: number
      readonly recoveryEncoding: 'ethereum' | 'validator-offset-4'
      readonly webauthn?: {
        readonly account: Address
        readonly usePrecompile: boolean
        readonly format: 'current' | 'v0'
      }
    }
  | {
      readonly kind: 'nested-threshold'
      readonly validator: ModuleId
      readonly factorOrder: readonly string[]
      readonly threshold: number
    }
  | {
      readonly kind: 'smart-session'
      readonly validator: ModuleId
      readonly mode: 'use' | 'enable-and-use' | 'pre-claim' | 'notarized'
      readonly permissionId: Hex
      readonly claimPolicyData?: Hex
      readonly enableData?: SmartSessionEnableContributionData
    }

export type ValidatorContributionInput =
  | {
      readonly kind: 'ecdsa'
      readonly ownerId: string
      readonly signature: Hex
      readonly encoding: 'raw-signer' | 'validator-contribution'
    }
  | {
      readonly kind: 'webauthn'
      readonly ownerId: string
      readonly publicKey: Hex
      readonly signature: Hex
      readonly authenticatorData: Hex
      readonly clientDataJSON: string
      readonly challengeIndex: number
      readonly typeIndex: number
      readonly userVerificationRequired: boolean
    }
  | {
      readonly kind: 'factor'
      readonly factorId: string
      readonly publicId: number | Hex
      readonly validator: Address
      readonly contribution: Hex
    }
  | {
      readonly kind: 'session'
      readonly signature: Hex
    }

export interface ValidatorCapabilities {
  readonly compatibilityKey: {
    readonly validatorKind: ValidatorKind
    readonly moduleAddress: Address
    readonly accountProfile: string
    readonly purpose: ValidatorSigningPurpose
  }
  readonly payloadKinds: readonly ValidatorPayloadKind[]
  readonly signatureModes: readonly string[]
  readonly signerTopology: 'single' | 'threshold' | 'nested-threshold'
  readonly supportsIndependentSigning: boolean
  readonly supportsOriginReuse: boolean
  readonly supportsMockSignature: boolean
  readonly supportsEip712: boolean
  readonly recoveryEncoding: 'ethereum' | 'validator-offset-4'
  readonly contributionCodec: ValidatorContributionCodec
}
