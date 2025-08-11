import { describe, expect, test } from 'vitest'
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { toCoinbaseSmartAccount } from 'viem/account-abstraction';
import { createRhinestoneAccount } from '..';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

describe('Custom Accounts', () => {
  describe('Coinbase, account', async () => {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(),
    });

    const owner = privateKeyToAccount(generatePrivateKey());

    const coinbaseAccount = await toCoinbaseSmartAccount({
      client,
      owners: [owner],
    });

    test('Coinbase, getAddress', async () => {
      const account = await createRhinestoneAccount({
        account: {
          type: 'custom',
          custom: {
            getDeployArgs: () => {
              return {
                factory: '0x',
                factoryData: '0x',
              };
            },
            getInstallData: () => {
              return [];
            },
            getAddress: () => {
              return coinbaseAccount.address;
            },
            getPackedSignature: async () => {
              return '0x';
            },
            getSessionStubSignature: async (session, enableData) => {
              return `0x`;
            },
            signSessionUserOperation: async (session, enableData, hash) => {
              return `0x`;
            },
            getStubSignature: async () => {
              return coinbaseAccount.getStubSignature();
            },
            sign: async (hash) => {
              return '0x';
            }
          }
        },
        owners: {
          type: 'ecdsa-v0',
          accounts: [owner],
          threshold: 1,
        },
        rhinestoneApiKey: ''
      });

      expect(account.getAddress()).toEqual(coinbaseAccount.address);
    })
  })
})
