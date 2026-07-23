import type { Account, Address } from 'viem'
import type { AccountDefinition, AccountInitData } from '../accounts/types'
import type { ConfiguredModule } from '../modules/types'
import type { ResolvedValidatorDefinition } from '../modules/validators/types'

export type ConfigProfileId = 'current-v2' | 'legacy-v0'

export type ResolvedAuth =
  | { readonly kind: 'api-key'; readonly apiKey: string }
  | {
      readonly kind: 'jwt'
      readonly accessToken: string | (() => Promise<string>)
      readonly getIntentExtensionToken?: (
        intentInput: unknown,
      ) => Promise<string>
    }

export type ResolvedProvider =
  | { readonly kind: 'public' }
  | {
      readonly kind: 'custom'
      readonly urls: Readonly<Record<number, string>>
    }

export type ResolvedServiceEndpoint =
  | {
      readonly kind: 'pimlico' | 'biconomy'
      readonly apiKey: string
    }
  | {
      readonly kind: 'custom'
      readonly urls: string | Readonly<Record<number, string>>
    }

export interface ResolvedSdkDefaultSelections {
  readonly orchestratorUrl: string
  readonly environment: 'production'
  readonly provider: 'public'
  readonly account: {
    readonly kind: 'nexus'
    readonly safeAdapterProfile:
      | 'safe-current-adapter'
      | 'safe-legacy-v0-adapter'
  }
}

export interface ResolvedSdkConfig {
  readonly profile: 'current-v2'
  readonly defaults: ResolvedSdkDefaultSelections
  readonly environment: 'production' | 'development'
  readonly auth: ResolvedAuth
  readonly orchestratorUrl: string
  readonly provider: ResolvedProvider
  readonly bundler?: ResolvedServiceEndpoint
  readonly paymaster?: ResolvedServiceEndpoint
  readonly headers: Readonly<Record<string, string>>
}

export type ResolvedAddressSelection<Profile extends string> =
  | { readonly source: 'explicit'; readonly address: Address }
  | { readonly source: 'default'; readonly profile: Profile }

export interface ResolvedSessionInstallation {
  readonly configured: boolean
  readonly enabled: boolean
  readonly module: ResolvedAddressSelection<'smart-session-emissary'>
  readonly compatibilityFallback: ResolvedAddressSelection<'safe-session-fallback'>
  readonly environment: 'production' | 'development'
}

export interface ResolvedAccountConfig {
  readonly profile: ConfigProfileId
  readonly account: AccountDefinition
  readonly owners?: ResolvedValidatorDefinition
  readonly eoa?: Account
  readonly modules: readonly ConfiguredModule[]
  readonly initData?: AccountInitData
  readonly sessions: ResolvedSessionInstallation
}

export type AccountInvocationKind =
  | 'deploy'
  | 'is-deployed'
  | 'setup'
  | 'get-init-data'
  | 'sign-eip7702-init-data'
  | 'prepare-intent'
  | 'get-intent-messages'
  | 'sign-intent'
  | 'assemble-intent'
  | 'sign-authorizations'
  | 'sign-message'
  | 'sign-typed-data'
  | 'submit-intent'
  | 'prepare-user-operation'
  | 'sign-user-operation'
  | 'submit-user-operation'
  | 'send-user-operation'
  | 'wait-for-execution'
  | 'get-address'
  | 'get-portfolio'
  | 'get-owners'
  | 'get-validators'
  | 'get-executors'
  | 'get-session-details'
  | 'is-session-enabled'
  | 'sign-enable-session'
  | 'lazy-call'

export interface AccountInvocationContext<CompatibilityConfig = unknown> {
  readonly method: AccountInvocationKind
  readonly sdk: ResolvedSdkConfig
  readonly account: ResolvedAccountConfig
  readonly compatibilityConfig: CompatibilityConfig
}
