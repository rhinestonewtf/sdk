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

export type AccountDefinition =
  | {
      readonly kind: 'safe'
      readonly version: '1.4.1'
      readonly adapter: '1.0.0' | '2.0.0'
    }
  | {
      readonly kind: 'nexus'
      readonly version:
        | '1.0.2'
        | '1.2.0'
        | 'rhinestone-1.0.0-beta'
        | 'rhinestone-1.0.0'
    }
  | {
      readonly kind: 'kernel'
      readonly version: '3.1' | '3.2' | '3.3'
    }
  | { readonly kind: 'startale' }
  | { readonly kind: 'hca' }
  | { readonly kind: 'eoa' }

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
