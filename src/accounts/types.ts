import type { Address, Hex } from 'viem'
import type { Call } from '../calls/types'
import type { EvmChainReference } from '../chains/types'
import type { ResolvedModule } from '../modules/types'

export type AccountKind =
  | 'safe'
  | 'nexus'
  | 'kernel'
  | 'startale'
  | 'hca'
  | 'eoa'

export type AccountInput =
  | {
      type: 'safe'
      version?: '1.4.1'
      adapter?: '1.0.0' | '2.0.0'
      nonce?: bigint
    }
  | {
      type: 'nexus'
      version?: '1.0.2' | '1.2.0' | 'rhinestone-1.0.0-beta' | 'rhinestone-1.0.0'
      salt?: Hex
    }
  | {
      type: 'kernel'
      version?: '3.1' | '3.2' | '3.3'
      salt?: Hex
    }
  | { type: 'startale'; salt?: Hex }
  | { type: 'hca'; factory?: Address }
  | { type: 'eoa' }

export type AccountValueSelection<Value, Profile extends string> =
  | { readonly source: 'explicit'; readonly value: Value }
  | { readonly source: 'default'; readonly profile: Profile }

export type AccountDefinition =
  | {
      readonly kind: 'safe'
      readonly version: AccountValueSelection<'1.4.1', 'safe-current-version'>
      readonly adapter: AccountValueSelection<
        '1.0.0' | '2.0.0',
        'safe-current-adapter' | 'safe-legacy-v0-adapter'
      >
      readonly nonce: AccountValueSelection<bigint, 'safe-zero-nonce'>
    }
  | {
      readonly kind: 'nexus'
      readonly version: AccountValueSelection<
        '1.0.2' | '1.2.0' | 'rhinestone-1.0.0-beta' | 'rhinestone-1.0.0',
        'nexus-current-version'
      >
      readonly salt: AccountValueSelection<Hex, 'nexus-empty-calldata-salt'>
    }
  | {
      readonly kind: 'kernel'
      readonly version: AccountValueSelection<
        '3.1' | '3.2' | '3.3',
        'kernel-current-version'
      >
      readonly salt: AccountValueSelection<Hex, 'kernel-zero-salt'>
    }
  | {
      readonly kind: 'startale'
      readonly salt: AccountValueSelection<Hex, 'startale-zero-salt'>
    }
  | {
      readonly kind: 'hca'
      readonly factory: AccountValueSelection<Address, 'hca-canonical-factory'>
    }
  | { readonly kind: 'eoa' }

export type AccountInitData =
  | {
      address: Address
      factory: Address
      factoryData: Hex
      intentExecutorInstalled: boolean
    }
  | { address: Address }

export interface AccountIdentity {
  readonly definition: AccountDefinition
  readonly address: Address
}

export interface AccountDeploymentPlan {
  readonly chain: EvmChainReference
  readonly address: Address
  readonly factory?: Address
  readonly factoryData?: Hex
  readonly initCode?: Hex
  readonly deployed: boolean
}

export type AccountSignatureEnvelope =
  | { readonly kind: 'none' }
  | { readonly kind: 'safe'; readonly validator: Address }
  | { readonly kind: 'nexus'; readonly validator: Address }
  | { readonly kind: 'kernel'; readonly validator: Address }
  | { readonly kind: 'startale'; readonly validator: Address }
  | { readonly kind: 'hca'; readonly validator: Address }

export interface AccountCapabilities {
  readonly modular: boolean
  readonly supportsDeployment: boolean
  readonly supportsUserOperations: boolean
  readonly supportsEip7702Adoption: boolean
  readonly supportsSmartSessions: boolean
  readonly supportsOriginSignatureReuse: boolean
  readonly signatureEnvelope: AccountSignatureEnvelope
}

export interface AccountModulePlan {
  readonly validators: readonly ResolvedModule[]
  readonly executors: readonly ResolvedModule[]
  readonly hooks: readonly ResolvedModule[]
  readonly fallbacks: readonly ResolvedModule[]
}

export interface AccountCallEncodingInput {
  readonly chain: EvmChainReference
  readonly calls: readonly Call[]
  readonly mode: 'single' | 'batch'
}
