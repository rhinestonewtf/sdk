import type { Address, Hex } from 'viem'
import type { ModuleId, ResolvedModule } from '../types'

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

export interface ValidatorOwner {
  readonly id: string
  readonly signerId: string
}

export interface AtomicValidatorDefinition {
  readonly kind: Exclude<ValidatorKind, 'multi-factor'>
  readonly id: string
  readonly module: ResolvedModule
  readonly owners: readonly ValidatorOwner[]
  readonly threshold: number
}

export interface MultiFactorValidatorDefinition {
  readonly kind: 'multi-factor'
  readonly id: string
  readonly module: ResolvedModule
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
