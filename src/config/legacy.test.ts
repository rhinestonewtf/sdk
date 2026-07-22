import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import { RhinestoneSDK } from '../index'
import type { AccountConstructionInput, SdkConstructionInput } from './input'
import { captureLegacySdkConfig, createLegacyAccountConfig } from './legacy'

const accountA = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const accountB = privateKeyToAccount(`0x${'22'.repeat(32)}`)

describe('legacy account config compatibility', () => {
  test('matches the public shallow merge, enumerable keys, and references', async () => {
    const owners = { type: 'ecdsa' as const, accounts: [accountA] }
    const modules: NonNullable<AccountConstructionInput['modules']> = []
    const sessions = { enabled: true }
    const accountInput = {
      owners,
      modules,
      experimental_sessions: sessions,
    }
    const provider = { type: 'custom' as const, urls: { 1: 'https://rpc' } }
    const headers = { 'x-test': 'value' }
    const sdkInput = {
      apiKey: 'legacy-secret',
      auth: { mode: 'apiKey' as const, apiKey: 'current-secret' },
      endpointUrl: 'https://orchestrator.test',
      provider,
      headers,
      useDevContracts: true,
    }

    const sdk = new RhinestoneSDK(sdkInput)
    const publicAccount = await sdk.createAccount(accountInput)
    const publicConfig = publicAccount.config
    const authProvider = Reflect.get(publicConfig, '_authProvider')
    expect(authProvider).toBeDefined()

    const capturedSdk = captureLegacySdkConfig(sdkInput, authProvider)
    const compatibilityConfig = createLegacyAccountConfig(
      accountInput,
      capturedSdk,
    )

    expect(Object.keys(compatibilityConfig)).toEqual(Object.keys(publicConfig))
    expect(compatibilityConfig).toEqual(publicConfig)
    expect(compatibilityConfig.owners).toBe(owners)
    expect(compatibilityConfig.modules).toBe(modules)
    expect(compatibilityConfig.experimental_sessions).toBe(sessions)
    expect(compatibilityConfig.provider).toBe(provider)
    expect(compatibilityConfig.headers).toBe(headers)
    expect(compatibilityConfig._authProvider).toBe(authProvider)
    expect(compatibilityConfig).not.toHaveProperty('apiKey')
    expect(compatibilityConfig).not.toHaveProperty('auth')
  })

  test('retains undefined SDK fields as enumerable compatibility keys', async () => {
    const sdkInput = { apiKey: 'test' } satisfies SdkConstructionInput
    const accountInput = {
      owners: { type: 'ecdsa' as const, accounts: [accountA] },
    }
    const sdk = new RhinestoneSDK(sdkInput)
    const publicAccount = await sdk.createAccount(accountInput)
    const authProvider = Reflect.get(publicAccount.config, '_authProvider')
    const compatibilityConfig = createLegacyAccountConfig(
      accountInput,
      captureLegacySdkConfig(sdkInput, authProvider),
    )

    expect(Object.keys(compatibilityConfig)).toEqual([
      'owners',
      '_authProvider',
      'endpointUrl',
      'provider',
      'bundler',
      'paymaster',
      'useDevContracts',
      'headers',
    ])
    expect(Object.keys(compatibilityConfig)).toEqual(
      Object.keys(publicAccount.config),
    )
  })

  test('keeps nested aliases live but detaches top-level input replacement', () => {
    const owners = { type: 'ecdsa' as const, accounts: [accountA] }
    const accountInput: AccountConstructionInput = { owners }
    const compatibilityConfig = createLegacyAccountConfig(accountInput, {
      authProvider: {},
      endpointUrl: undefined,
      provider: undefined,
      bundler: undefined,
      paymaster: undefined,
      useDevContracts: undefined,
      headers: undefined,
    })

    accountInput.owners = { type: 'ecdsa', accounts: [accountB] }
    owners.accounts.push(accountB)

    expect(compatibilityConfig.owners).toBe(owners)
    expect(
      compatibilityConfig.owners?.type === 'ecdsa'
        ? compatibilityConfig.owners.accounts
        : [],
    ).toEqual([accountA, accountB])
  })

  test('captures SDK top-level fields while retaining their nested aliases', () => {
    const urls = { 1: 'https://initial.test' }
    const initialProvider = { type: 'custom' as const, urls }
    const sdkInput: SdkConstructionInput = {
      apiKey: 'test',
      provider: initialProvider,
    }
    const captured = captureLegacySdkConfig(sdkInput, {})

    sdkInput.provider = { type: 'alchemy', apiKey: 'replacement' }
    urls[1] = 'https://mutated.test'

    expect(captured.provider).toBe(initialProvider)
    expect(
      captured.provider?.type === 'custom' && captured.provider.urls[1],
    ).toBe('https://mutated.test')
  })

  test('shares one auth provider without sharing account compatibility objects', () => {
    const sdkInput = { apiKey: 'test' } satisfies SdkConstructionInput
    const authProvider = {}
    const captured = captureLegacySdkConfig(sdkInput, authProvider)
    const first = createLegacyAccountConfig(
      { owners: { type: 'ecdsa', accounts: [accountA] } },
      captured,
    )
    const second = createLegacyAccountConfig(
      { owners: { type: 'ecdsa', accounts: [accountB] } },
      captured,
    )

    expect(first).not.toBe(second)
    expect(first._authProvider).toBe(authProvider)
    expect(second._authProvider).toBe(authProvider)
    first.endpointUrl = 'https://first.test'
    expect(second.endpointUrl).toBeUndefined()
  })

  test('public methods retain the captured config after property reassignment', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'test' })
    const account = await sdk.createAccount({
      account: { type: 'eoa' },
      eoa: accountA,
    })
    const captured = account.config

    account.config = {
      account: { type: 'eoa' },
      eoa: accountB,
    }
    expect(account.getAddress()).toBe(accountA.address)

    captured.eoa = accountB
    expect(account.getAddress()).toBe(accountB.address)
  })
})
