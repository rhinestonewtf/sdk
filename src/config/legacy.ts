import type { AccountConstructionInput, SdkConstructionInput } from './input'

export interface LegacySdkConfigSnapshot<AuthProvider> {
  readonly authProvider: AuthProvider
  readonly endpointUrl: SdkConstructionInput['endpointUrl']
  readonly provider: SdkConstructionInput['provider']
  readonly bundler: SdkConstructionInput['bundler']
  readonly paymaster: SdkConstructionInput['paymaster']
  readonly useDevContracts: SdkConstructionInput['useDevContracts']
  readonly headers: SdkConstructionInput['headers']
  readonly hyperliquid: SdkConstructionInput['hyperliquid']
}

export type LegacyAccountConfig<AuthProvider> = AccountConstructionInput & {
  _authProvider?: AuthProvider
  endpointUrl?: SdkConstructionInput['endpointUrl']
  provider?: SdkConstructionInput['provider']
  bundler?: SdkConstructionInput['bundler']
  paymaster?: SdkConstructionInput['paymaster']
  useDevContracts?: SdkConstructionInput['useDevContracts']
  headers?: SdkConstructionInput['headers']
  hyperliquid?: SdkConstructionInput['hyperliquid']
}

export function captureLegacySdkConfig<AuthProvider>(
  input: SdkConstructionInput,
  authProvider: AuthProvider,
): LegacySdkConfigSnapshot<AuthProvider> {
  return {
    authProvider,
    endpointUrl: input.endpointUrl,
    provider: input.provider,
    bundler: input.bundler,
    paymaster: input.paymaster,
    useDevContracts: input.useDevContracts,
    headers: input.headers,
    hyperliquid: input.hyperliquid,
  }
}

export function createLegacyAccountConfig<AuthProvider>(
  input: AccountConstructionInput,
  sdk: LegacySdkConfigSnapshot<AuthProvider>,
): LegacyAccountConfig<AuthProvider> {
  return {
    ...input,
    _authProvider: sdk.authProvider,
    endpointUrl: sdk.endpointUrl,
    provider: sdk.provider,
    bundler: sdk.bundler,
    paymaster: sdk.paymaster,
    useDevContracts: sdk.useDevContracts,
    headers: sdk.headers,
    hyperliquid: sdk.hyperliquid,
  }
}
