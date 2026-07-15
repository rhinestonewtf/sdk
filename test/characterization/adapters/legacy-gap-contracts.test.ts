import type { WalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import { WalletClientNoConnectedAccountError } from '../../../src/errors'
import { RhinestoneSDK } from '../../../src/index'
import { walletClientToAccount } from '../../../src/utils/walletClient'

describe('legacy explicit gap contracts', () => {
  test('validators/missing-signer', () => {
    const adapt = () =>
      walletClientToAccount({ account: undefined } as WalletClient)
    expect(adapt).toThrowError(WalletClientNoConnectedAccountError)
    expect(adapt).toThrowError('missing a default account')
  })

  test('intents/convenience-send', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline-characterization' })
    const account = await sdk.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [privateKeyToAccount(`0x${'02'.repeat(32)}`)],
      },
    })

    expect(Reflect.has(account, 'sendTransaction')).toBe(false)
    expect(Reflect.has(account, 'sendUserOperation')).toBe(true)
  })
})
