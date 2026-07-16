import type { Address } from 'viem'
import type {
  AccountDefinition,
  AccountInput,
  AccountValueSelection,
} from '../accounts/types'
import type {
  ConfiguredModule,
  ModuleDataSelection,
  ModuleInput,
} from '../modules/types'
import { defineValidator } from '../modules/validators/definition'
import {
  currentV2Defaults,
  type SdkSemanticConfigDefaults,
  type SemanticConfigDefaults,
  standaloneDefaults,
} from './defaults'
import type {
  AccountConstructionInput,
  ProviderInput,
  SdkAuthInput,
  SdkConstructionInput,
  ServiceInput,
} from './input'
import type { LegacyAccountConfig } from './legacy'
import type {
  AccountInvocationContext,
  AccountInvocationKind,
  ConfigProfileId,
  ResolvedAccountConfig,
  ResolvedAddressSelection,
  ResolvedAuth,
  ResolvedProvider,
  ResolvedSdkConfig,
  ResolvedServiceEndpoint,
  ResolvedSessionInstallation,
} from './resolved'

const emptyHeaders: Readonly<Record<string, string>> = Object.freeze({})

function selectValue<Value, Profile extends string>(
  value: Value | undefined,
  profile: Profile,
): AccountValueSelection<Value, Profile> {
  return value === undefined
    ? { source: 'default', profile }
    : { source: 'explicit', value }
}

function selectAddress<Profile extends string>(
  address: Address | undefined,
  profile: Profile,
): ResolvedAddressSelection<Profile> {
  return address === undefined
    ? { source: 'default', profile }
    : { source: 'explicit', address }
}

function selectModuleData(value: ModuleInput['initData']): ModuleDataSelection {
  return value === undefined
    ? { source: 'omitted' }
    : { source: 'explicit', value }
}

function configureModules(
  modules: AccountConstructionInput['modules'],
): readonly ConfiguredModule[] {
  return (modules ?? []).map((module) => ({
    kind: module.type,
    address: module.address,
    initData: selectModuleData(module.initData),
    deInitData: selectModuleData(module.deInitData),
    additionalContext: selectModuleData(module.additionalContext),
  }))
}

function resolveAuth(input: SdkConstructionInput): ResolvedAuth {
  let auth: SdkAuthInput | undefined
  if ('auth' in input && input.auth) {
    auth = input.auth
  } else if ('apiKey' in input && input.apiKey) {
    auth = { mode: 'apiKey', apiKey: input.apiKey }
  }

  if (!auth) {
    throw new Error(
      'RhinestoneSDK requires either `apiKey` or `auth` in config',
    )
  }
  if (auth.mode === 'apiKey') {
    return { kind: 'api-key', apiKey: auth.apiKey }
  }
  return {
    kind: 'jwt',
    accessToken: auth.accessToken,
    ...(auth.getIntentExtensionToken
      ? { getIntentExtensionToken: auth.getIntentExtensionToken }
      : {}),
  }
}

function resolveProvider(input: ProviderInput | undefined): ResolvedProvider {
  if (!input) return { kind: 'public' }
  if (input.type === 'alchemy') {
    return { kind: 'alchemy', apiKey: input.apiKey }
  }
  return { kind: 'custom', urls: input.urls }
}

function resolveService(
  input: ServiceInput | undefined,
): ResolvedServiceEndpoint | undefined {
  if (!input) return undefined
  if (input.type === 'custom') {
    return { kind: 'custom', urls: input.url }
  }
  return { kind: input.type, apiKey: input.apiKey }
}

function resolveAccountDefinition(
  input: AccountInput | undefined,
  defaults: SemanticConfigDefaults,
): AccountDefinition {
  const account = input ?? { type: defaults.account.kind }
  switch (account.type) {
    case 'safe':
      return {
        kind: 'safe',
        version: selectValue(account.version, 'safe-current-version'),
        adapter: selectValue(
          account.adapter,
          defaults.account.safeAdapterProfile,
        ),
        nonce: selectValue(account.nonce, 'safe-zero-nonce'),
      }
    case 'nexus':
      return {
        kind: 'nexus',
        version: selectValue(account.version, 'nexus-current-version'),
        salt: selectValue(account.salt, 'nexus-empty-calldata-salt'),
      }
    case 'kernel':
      return {
        kind: 'kernel',
        version: selectValue(account.version, 'kernel-current-version'),
        salt: selectValue(account.salt, 'kernel-zero-salt'),
      }
    case 'startale':
      return {
        kind: 'startale',
        salt: selectValue(account.salt, 'startale-zero-salt'),
      }
    case 'hca':
      return {
        kind: 'hca',
        factory: selectValue(account.factory, 'hca-canonical-factory'),
      }
    case 'eoa':
      return { kind: 'eoa' }
  }
}

function resolveSessions(
  input: AccountConstructionInput['experimental_sessions'],
  environment: ResolvedSdkConfig['environment'],
): ResolvedSessionInstallation {
  return {
    configured: input !== undefined,
    enabled: input?.enabled ?? false,
    module: selectAddress(input?.module, 'smart-session-emissary'),
    compatibilityFallback: selectAddress(
      input?.compatibilityFallback,
      'safe-session-fallback',
    ),
    environment,
  }
}

function resolveAccountWithDefaults(
  input: AccountConstructionInput,
  defaults: SemanticConfigDefaults,
  environment: ResolvedSdkConfig['environment'],
): ResolvedAccountConfig {
  return {
    profile: defaults.id,
    account: resolveAccountDefinition(input.account, defaults),
    ...(input.owners ? { owners: defineValidator(input.owners) } : {}),
    ...(input.eoa ? { eoa: input.eoa } : {}),
    modules: configureModules(input.modules),
    ...(input.initData ? { initData: input.initData } : {}),
    sessions: resolveSessions(input.experimental_sessions, environment),
  }
}

export function resolveSdkConfig(
  input: SdkConstructionInput,
  defaults: SdkSemanticConfigDefaults = currentV2Defaults,
): ResolvedSdkConfig {
  const bundler = resolveService(input.bundler)
  const paymaster = resolveService(input.paymaster)
  return {
    profile: defaults.id,
    defaults: {
      orchestratorUrl: defaults.orchestratorUrl,
      environment: defaults.environment,
      provider: defaults.provider,
      account: { ...defaults.account },
    },
    environment:
      input.useDevContracts === true ? 'development' : defaults.environment,
    auth: resolveAuth(input),
    orchestratorUrl: input.endpointUrl ?? defaults.orchestratorUrl,
    provider: resolveProvider(input.provider),
    ...(bundler ? { bundler } : {}),
    ...(paymaster ? { paymaster } : {}),
    headers: input.headers ?? emptyHeaders,
  }
}

export function resolveAccountConfig(
  sdk: ResolvedSdkConfig,
  input: AccountConstructionInput,
): ResolvedAccountConfig {
  return resolveAccountWithDefaults(
    input,
    { id: sdk.profile, ...sdk.defaults },
    sdk.environment,
  )
}

export function resolveConfig(
  sdkInput: SdkConstructionInput,
  accountInput: AccountConstructionInput,
  defaults: SdkSemanticConfigDefaults = currentV2Defaults,
): {
  readonly sdk: ResolvedSdkConfig
  readonly account: ResolvedAccountConfig
} {
  const sdk = resolveSdkConfig(sdkInput, defaults)
  return { sdk, account: resolveAccountConfig(sdk, accountInput) }
}

export function resolveStandaloneAccountConfig(
  input: AccountConstructionInput,
  profile: ConfigProfileId,
): ResolvedAccountConfig {
  return resolveAccountWithDefaults(
    input,
    standaloneDefaults[profile],
    'production',
  )
}

function materializeSdkInvocationConfig<AuthProvider>(
  sdk: ResolvedSdkConfig,
  compatibility: LegacyAccountConfig<AuthProvider>,
): ResolvedSdkConfig {
  const bundler = resolveService(compatibility.bundler)
  const paymaster = resolveService(compatibility.paymaster)
  return {
    profile: sdk.profile,
    defaults: sdk.defaults,
    auth: sdk.auth,
    environment:
      compatibility.useDevContracts === true
        ? 'development'
        : sdk.defaults.environment,
    orchestratorUrl: compatibility.endpointUrl ?? sdk.defaults.orchestratorUrl,
    provider: resolveProvider(compatibility.provider),
    ...(bundler ? { bundler } : {}),
    ...(paymaster ? { paymaster } : {}),
    headers: compatibility.headers ?? emptyHeaders,
  }
}

export function materializeAccountInvocationContext<AuthProvider>(
  sdk: ResolvedSdkConfig,
  compatibilityConfig: LegacyAccountConfig<AuthProvider>,
  method: AccountInvocationKind,
): AccountInvocationContext<LegacyAccountConfig<AuthProvider>> {
  const invocationSdk = materializeSdkInvocationConfig(sdk, compatibilityConfig)
  return {
    method,
    sdk: invocationSdk,
    account: resolveAccountConfig(invocationSdk, compatibilityConfig),
    compatibilityConfig,
  }
}
