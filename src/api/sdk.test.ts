import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
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
