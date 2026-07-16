import type { Address } from 'viem'
import type {
  AccountCapabilities,
  AccountDefinition,
  AccountIdentity,
} from '../accounts/types'
import type { ResolvedModule } from '../modules/types'
import type {
  ResolvedValidatorDefinition,
  ValidatorCapabilities,
} from '../modules/validators/types'

export type ResolvedAuth =
  | { readonly kind: 'api-key'; readonly apiKey: string }
  | { readonly kind: 'jwt'; readonly getToken: () => Promise<string> }

export type ResolvedProvider =
  | { readonly kind: 'alchemy'; readonly apiKey: string }
  | {
      readonly kind: 'custom'
      readonly urls: Readonly<Record<number, string>>
    }

export interface ResolvedServiceEndpoint {
  readonly kind: 'bundler' | 'paymaster'
  readonly provider: 'pimlico' | 'biconomy' | 'custom'
  readonly urls: string | Readonly<Record<number, string>>
}

export interface ResolvedSdkConfig {
  readonly environment: 'production' | 'development'
  readonly auth: ResolvedAuth
  readonly orchestratorUrl: string
  readonly provider: ResolvedProvider
  readonly bundler?: ResolvedServiceEndpoint
  readonly paymaster?: ResolvedServiceEndpoint
  readonly headers: Readonly<Record<string, string>>
  readonly defaultAccount: AccountDefinition
}

export interface ResolvedAccountConfig {
  readonly identity: AccountIdentity
  readonly capabilities: AccountCapabilities
  readonly validator: ResolvedValidatorDefinition
  readonly validatorCapabilities: ValidatorCapabilities
  readonly modules: readonly ResolvedModule[]
  readonly sessions: {
    readonly enabled: boolean
    readonly module?: Address
    readonly environment: 'production' | 'development'
  }
}

export interface AccountInvocationContext<CompatibilityConfig = unknown> {
  readonly sdk: ResolvedSdkConfig
  readonly account: ResolvedAccountConfig
  readonly compatibilityConfig: CompatibilityConfig
}
