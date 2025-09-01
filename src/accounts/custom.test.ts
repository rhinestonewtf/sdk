import { createPublicClient, http } from 'viem'
import { toCoinbaseSmartAccount } from 'viem/account-abstraction'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { createRhinestoneAccount } from '..'

describe('Custom Accounts', () => {
  describe('Coinbase, account', async () => {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(),
    })

    const owner = privateKeyToAccount(generatePrivateKey())

    const coinbaseAccount = await toCoinbaseSmartAccount({
      client,
      owners: [owner],
    })

    test('Coinbase, getAddress', async () => {
      const account = await createRhinestoneAccount({
        account: {
          type: 'custom',
          custom: {
            getDeployArgs: () => {
              return {
                factory: '0x',
                factoryData: '0x',
              }
            },
            getInstallData: () => {
              return []
            },
            getAddress: () => {
              return coinbaseAccount.address
            },
            getPackedSignature: async () => {
              throw new Error('Not implemented')
            },
            getSessionStubSignature: async () => {
              throw new Error('Not implemented')
            },
            signSessionUserOperation: async () => {
              throw new Error('Not implemented')
            },
            getStubSignature: async () => {
              return coinbaseAccount.getStubSignature()
            },
            sign: async () => {
              throw new Error('Not implemented')
            },
          },
        },
        owners: {
          type: 'ecdsa-v0',
          accounts: [owner],
          threshold: 1,
        },
        rhinestoneApiKey: '',
      })

      expect(account.getAddress()).toEqual(coinbaseAccount.address)
    })
  })
})
