import type { Account, Address, Hex } from 'viem'
import type { Call } from '../calls/types'
import type { EvmChainReference } from '../chains/types'
import type { ConfiguredModule, ModuleSetup } from '../modules/types'
import type { ResolvedValidatorDefinition } from '../modules/validators/types'

export type AccountKind =
  | 'safe'
  | 'nexus'
  | 'kernel'
  | 'startale'
  | 'hca'
  | 'eoa'

export type AccountType =
  | 'safe'
  | 'nexus'
  | 'kernel'
  | 'startale'
  | 'eoa'
  | 'hca'

export type AccountInput =
  | {
      type: 'safe'
      version?: '1.4.1'
      adapter?: '1.0.0' | '2.0.0'
      nonce?: bigint
    }
  | {
      type: 'nexus'
      version?: '1.2.0' | '1.2.1'
      salt?: Hex
    }
  | {
      type: 'kernel'
      version?: '3.3'
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
        '1.2.0' | '1.2.1',
        'nexus-current-version'
      >
      readonly salt: AccountValueSelection<Hex, 'nexus-empty-calldata-salt'>
    }
  | {
      readonly kind: 'kernel'
      readonly version: AccountValueSelection<'3.3', 'kernel-current-version'>
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

export interface AccountConstruction {
  readonly account: AccountDefinition
  readonly owner?: ResolvedValidatorDefinition
  readonly modules: readonly ConfiguredModule[]
  readonly setup: AccountModulePlan
  readonly sessions: {
    readonly enabled: boolean
    readonly environment: 'production' | 'development'
  }
  readonly initData?: AccountInitData
  readonly eoa?: Account
  readonly chain: EvmChainReference
  readonly deployed: boolean
}

export interface AccountDeploymentPlan {
  readonly chain: EvmChainReference
  readonly address: Address
  readonly factory?: Address
  readonly factoryData?: Hex
  readonly initCode?: Hex
  readonly deployed: boolean
}

export interface AccountEip7702AdoptionPlan {
  readonly contract: Address
  readonly initData: Hex
}

export type AccountSignatureEnvelope =
  | { readonly kind: 'none' }
  | { readonly kind: 'safe'; readonly validator: Address }
  | { readonly kind: 'nexus'; readonly validator: Address }
  | {
      readonly kind: 'kernel'
      readonly validator: Address
      readonly isRoot: boolean
    }
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

export type AccountModulePlan = ModuleSetup

export interface AccountCallEncodingInput {
  readonly chain: EvmChainReference
  readonly calls: readonly Call[]
  readonly mode: 'single' | 'batch'
}
