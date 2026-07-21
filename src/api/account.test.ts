import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import type { RhinestoneAccountConfig } from '../index'
import { RhinestoneSDK } from '../index'

describe('account instance surface', () => {
  test('exposes sendUserOperation and no sendTransaction convenience method', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const account = await sdk.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [privateKeyToAccount(`0x${'02'.repeat(32)}`)],
      },
    })

    expect(Reflect.has(account, 'sendUserOperation')).toBe(true)
    expect(Reflect.has(account, 'sendTransaction')).toBe(false)
  })
})

describe('account config compatibility snapshot', () => {
  test('retains account-config keys, nested aliasing, and auth exposure', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const owners: RhinestoneAccountConfig['owners'] = {
      type: 'ecdsa',
      accounts: [privateKeyToAccount(`0x${'02'.repeat(32)}`)],
    }
    const provider: RhinestoneAccountConfig['account'] = {
      type: 'nexus',
      version: '1.2.0',
    }
    const input: RhinestoneAccountConfig = { account: provider, owners }
    const account = await sdk.createAccount(input)

    // Account-config keys survive by value.
    expect(account.config.account).toEqual(provider)
    expect(account.config.owners).toEqual(owners)

    // Shallow copy: nested references are aliased, so later method calls (which
    // re-read the live config) observe post-construction mutations to them.
    expect(account.config.owners).toBe(owners)
    expect(account.config.account).toBe(provider)

    // SDK-scoped auth is exposed on the account config snapshot.
    expect('_authProvider' in account.config).toBe(true)
  })
})
