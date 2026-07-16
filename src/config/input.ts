import type { Address } from 'viem'
import type { AccountDefinition, AccountKind } from '../accounts/types'
import type { ResolvedModule } from '../modules/types'
import type { ResolvedValidatorDefinition } from '../modules/validators/types'

export type SdkAuthInput =
  | { readonly kind: 'api-key'; readonly apiKey: string }
  | {
      readonly kind: 'jwt'
      readonly getToken: () => Promise<string>
    }

export type ProviderInput =
  | { readonly kind: 'alchemy'; readonly apiKey: string }
  | { readonly kind: 'custom'; readonly urls: Readonly<Record<number, string>> }

export type BundlerInput =
  | { readonly kind: 'pimlico' | 'biconomy'; readonly apiKey: string }
  | {
      readonly kind: 'custom'
      readonly urls: string | Readonly<Record<number, string>>
    }

export type PaymasterInput = BundlerInput

export interface SdkConstructionInput {
  readonly auth: SdkAuthInput
  readonly endpoint?: string
  readonly environment?: 'production' | 'development'
  readonly provider?: ProviderInput
  readonly bundler?: BundlerInput
  readonly paymaster?: PaymasterInput
  readonly headers?: Readonly<Record<string, string>>
  readonly defaultAccountKind?: AccountKind
}

export interface AccountConstructionInput {
  readonly account?: AccountDefinition
  readonly address?: Address
  readonly validator: ResolvedValidatorDefinition
  readonly modules?: readonly ResolvedModule[]
  readonly sessions?: {
    readonly enabled?: boolean
    readonly module?: Address
    readonly environment?: 'production' | 'development'
  }
}
