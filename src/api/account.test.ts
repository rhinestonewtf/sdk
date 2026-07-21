import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
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
