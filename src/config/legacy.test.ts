import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import { RhinestoneSDK } from '../index'
import type { AccountConstructionInput, SdkConstructionInput } from './input'
import { captureLegacySdkConfig, createLegacyAccountConfig } from './legacy'

const accountA = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const accountB = privateKeyToAccount(`0x${'22'.repeat(32)}`)

describe('legacy account config compatibility', () => {
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
      hyperliquid: undefined,
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

    sdkInput.provider = {
      type: 'custom',
      urls: { 1: 'https://replacement.test' },
    }
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
    const owners = { type: 'ecdsa' as const, accounts: [accountA] }
    const input = { evm: { owners } }
    const account = await sdk.createAccount(input)
    const captured = account.config

    ;(account as unknown as { config: unknown }).config = {
      evm: {
        account: { type: 'eoa' },
        eoa: accountB,
      },
    }
    const original = account.getAddress('evm')

    owners.accounts[0] = accountB
    expect(captured.evm.owners.accounts[0]).toBe(accountB)
    expect(account.getAddress('evm')).not.toBe(original)

    ;(captured.evm as AccountConstructionInput).owners = {
      type: 'ecdsa',
      accounts: [accountA],
    }
    expect(account.getAddress('evm')).toBe(original)
  })
})
