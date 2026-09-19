import { privateKeyToAccount } from 'viem/accounts'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { OwnersFieldRequiredError } from '../accounts/error'
import { solanaAddress } from '../chains/non-evm'
import {
  AccountVmNotConfiguredError,
  InvalidAccountConfigError,
  ManagedSolanaAccountNotSupportedError,
} from '../errors/capability'
import { RhinestoneSDK } from './sdk'

const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const receiver = solanaAddress('11111111111111111111111111111111')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RhinestoneSDK', () => {
  test('rejects missing owners asynchronously during account creation', async () => {
    const result = new RhinestoneSDK({ apiKey: 'offline' }).createAccount({
      evm: { account: { type: 'safe' } },
    })

    expect(result).toBeInstanceOf(Promise)
    await expect(result).rejects.toThrowError(OwnersFieldRequiredError)
  })

  test('creates address-only receivers without management capabilities', async () => {
    const account = await new RhinestoneSDK({
      apiKey: 'offline',
    }).createAccount({ solana: { address: receiver } })

    expect(account.getAddress('solana')).toBe(receiver)
    expect('prepareTransaction' in account).toBe(false)
    expect(Object.isFrozen(account.config)).toBe(true)
    expect(Reflect.deleteProperty(account.config, 'solana')).toBe(false)
    expect(Reflect.set(account.config, 'solana', { address: receiver })).toBe(
      false,
    )
    expect(() =>
      (account as never as { getAddress(vm: string): string }).getAddress(
        'evm',
      ),
    ).toThrow(AccountVmNotConfiguredError)
  })

  test('preserves EVM identity when a Solana receiver is added', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const evm = { account: { type: 'eoa' as const }, eoa: owner }
    const evmOnly = await sdk.createAccount({ evm })
    const combined = await sdk.createAccount({
      evm,
      solana: { address: receiver },
    })

    expect(combined.getAddress('evm')).toBe(evmOnly.getAddress('evm'))
    expect(combined.getAddress('solana')).toBe(receiver)
  })

  test('rejects managed Solana before composing a partial EVM account', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    await expect(
      sdk.createAccount({
        evm: { account: { type: 'eoa' }, eoa: owner },
        solana: { owner: { type: 'ecdsa', account: owner } },
      }),
    ).rejects.toThrow(ManagedSolanaAccountNotSupportedError)
  })

  test('asks for the recorded detail block only when told to', async () => {
    // Mirrors the server: the detail block comes back only for `?full=true`.
    const fetch = vi.fn(async (url: string) =>
      Response.json({
        traceId: 'trace-1',
        intentId: 'intent-1',
        purpose: 'execution',
        status: 'COMPLETED',
        operations: [],
        ...(url.includes('full=true')
          ? {
              details: {
                source: [],
                destination: { tokens: [] },
                deployments: [],
                cost: { sponsored: false },
              },
            }
          : {}),
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const sdk = new RhinestoneSDK({ apiKey: 'test' })

    const lean = await sdk.getIntentStatus('intent-1')
    expect(fetch.mock.calls[0]?.[0]).not.toContain('full=true')
    expect(lean.details).toBeUndefined()

    const full = await sdk.getIntentStatus('intent-1', { full: true })
    expect(fetch.mock.calls[1]?.[0]).toContain('/intents/intent-1?full=true')
    expect(full.details).toBeDefined()
  })

  test.each([
    {},
    { owners: { type: 'ecdsa', accounts: [owner] } },
    { solana: { address: 'not-base58' } },
    {
      evm: {
        address: owner.address,
        owners: { type: 'ecdsa', accounts: [owner] },
      },
    },
  ])('rejects malformed dynamic account input', async (config) => {
    await expect(
      new RhinestoneSDK({ apiKey: 'offline' }).createAccount(config as never),
    ).rejects.toThrow(InvalidAccountConfigError)
  })
})
