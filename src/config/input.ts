import type { Account, Address } from 'viem'
import type { AccountInitData, AccountInput } from '../accounts/types'
import type { ModuleInput } from '../modules/types'
import type { ValidatorInput } from '../modules/validators/types'

export type SdkAuthInput =
  | { mode: 'apiKey'; apiKey: string }
  | {
      mode: 'experimental_jwt'
      accessToken: string | (() => Promise<string>)
      getIntentExtensionToken?: (intentInput: unknown) => Promise<string>
    }

export type ProviderInput = {
  type: 'custom'
  urls: Record<number, string>
}

export type ServiceInput =
  | {
      type: 'pimlico' | 'biconomy'
      apiKey: string
    }
  | {
      type: 'custom'
      url: string | Record<number, string>
    }

export type BundlerInput = ServiceInput
export type PaymasterInput = ServiceInput

interface SdkConstructionInputBase {
  provider?: ProviderInput
  bundler?: BundlerInput
  paymaster?: PaymasterInput
  endpointUrl?: string
  useDevContracts?: boolean
  headers?: Record<string, string>
}

export type SdkConstructionInput = SdkConstructionInputBase &
  (
    | { apiKey: string; auth?: SdkAuthInput }
    | { auth: SdkAuthInput; apiKey?: string }
  )

export interface AccountConstructionInput {
  account?: AccountInput
  owners?: ValidatorInput
  sessions?: {
    enabled: boolean
    module?: Address
    compatibilityFallback?: Address
  }
  eoa?: Account
  modules?: ModuleInput[]
  initData?: AccountInitData
}
