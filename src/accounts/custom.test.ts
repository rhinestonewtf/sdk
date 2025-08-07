import { describe, expect, test } from 'vitest'
import { toSafeSmartAccount } from "permissionless/accounts";
import { Address, createPublicClient, encodeAbiParameters, fromHex, http, toHex } from 'viem';
import { base } from 'viem/chains';
import { entryPoint07Address } from 'viem/account-abstraction';
import { createRhinestoneAccount } from '..';
import {
  getMockSignature,
  SMART_SESSION_MODE_ENABLE,
  getPermissionId,
  SMART_SESSION_MODE_USE,
  encodeSmartSessionSignature,
} from '../modules/validators'

export const getOwnableValidator = ({
  threshold,
  owners,
  hook,
}: {
  threshold: number
  owners: Address[]
  hook?: Address
}) => {
  return {
    address: '0x2483DA3A338895199E5e538530213157e931Bf06',
    module: '0x2483DA3A338895199E5e538530213157e931Bf06',
    initData: encodeAbiParameters(
      [
        { name: 'threshold', type: 'uint256' },
        { name: 'owners', type: 'address[]' },
      ],
      [
        BigInt(threshold),
        owners.map((owner) => owner.toLowerCase() as Address).sort(),
      ],
    ),
    deInitData: '0x',
    additionalContext: '0x',
    hook,
    type: 'validator',
  }
}

describe('Custom Accounts', () => {
  describe('Permissionless, Safe account', async () => {
    const ownableValidator = getOwnableValidator({
      owners: ['0x61B4f7087A9AA04e583a190B5451735fa7D9a77D'],
      threshold: 1,
    });
    const publicClient = createPublicClient({
      chain: base,
      transport: http(),
    });
    const safeAccount = await toSafeSmartAccount({
      client: publicClient,
      owners: [],
      version: '1.4.1',
      address: '0x21eB8d6d6A278052b80A5901c26EB1D52Ba16D88',
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
      safe4337ModuleAddress: '0x7579EE8307284F293B1927136486880611F20002',
      erc7579LaunchpadAddress: '0x7579011aB74c46090561ea277Ba79D510c6C00ff',
      attesters: [
        '0x000000333034E9f539ce08819E12c1b8Cb29084d', // Rhinestone Attester
      ],
      attestersThreshold: 1,
      validators: [
        {
          address: ownableValidator.address as Address,
          context: ownableValidator.initData,
        },
      ],
      saltNonce: fromHex(toHex('zyfai-staging'), 'bigint'),
    });

    test('Permissionless, Safe account', async () => {
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
              return safeAccount.address;
            },
            getPackedSignature: async () => {
              return '0x';
            },
            getSessionStubSignature: async (session, enableData) => {
              const dummyOpSignature = getMockSignature(session.owners);

              if (enableData) {
                return encodeSmartSessionSignature(
                  SMART_SESSION_MODE_ENABLE,
                  getPermissionId(session),
                  dummyOpSignature,
                  enableData
                );
              }
              return encodeSmartSessionSignature(
                SMART_SESSION_MODE_USE,
                getPermissionId(session),
                dummyOpSignature
              );
            },
            signSessionUserOperation: async (session, enableData, hash) => {
              const signature = await safeAccount.sign({ hash });

              if (enableData) {
                return encodeSmartSessionSignature(
                  SMART_SESSION_MODE_ENABLE,
                  getPermissionId(session),
                  signature,
                  enableData
                );
              }
              return encodeSmartSessionSignature(
                SMART_SESSION_MODE_USE,
                getPermissionId(session),
                signature
              );
            },
            getStubSignature: async () => {
              return safeAccount.getStubSignature();
            },
            sign: async (hash) => {
              return '0x';
            }
          }
        },
        owners: {
          type: 'ecdsa',
          accounts: [],
          threshold: 1,
        },
        rhinestoneApiKey: ''
      });

      expect(account.getAddress()).toEqual(safeAccount.address);
      expect(safeAccount.address).toEqual('0x21eB8d6d6A278052b80A5901c26EB1D52Ba16D88');
    })
  })
})
