import type { Address } from 'viem'
import { decodeFunctionData, parseAbi } from 'viem'
import { describe, expect, test } from 'vitest'

import { accountA, accountB, passkeyAccount } from '../../test/consts'
import { MODULE_TYPE_ID_VALIDATOR } from '../modules/common'
import { AccountConfigurationNotSupportedError } from './error'
import {
  ENS_HCA_MODULE,
  getAddress,
  getDeployArgs,
  getInstallData,
  packSignature,
} from './hca'

const MOCK_MODULE_ADDRESS = '0x28de6501fa86f2e6cd0b33c3aabdaeb4a1b93f3f'

describe('Accounts: HCA', () => {
  describe('Deploy Args', () => {
    test('ENS owner with expirations', () => {
      const result = getDeployArgs({
        account: { type: 'hca' },
        owners: {
          type: 'ens',
          owners: [{ account: accountA }],
        },
      })
      expect(result).not.toBeNull()
      const { factory, factoryData, implementation } = result!
      expect(factory).toBeDefined()
      expect(factoryData).toBeDefined()
      expect(implementation).toBeDefined()

      // Verify factoryData encodes createAccount(bytes)
      const decoded = decodeFunctionData({
        abi: parseAbi(['function createAccount(bytes)']),
        data: factoryData,
      })
      expect(decoded.functionName).toEqual('createAccount')
      expect(decoded.args[0]).toBeDefined()
    })

    test('ENS owner with multiple owners and threshold', () => {
      const result = getDeployArgs({
        account: { type: 'hca' },
        owners: {
          type: 'ens',
          owners: [
            { account: accountA },
            { account: accountB, expiration: new Date(1000000 * 1000) },
          ],
          threshold: 2,
        },
      })
      expect(result).not.toBeNull()
      const { factoryData } = result!
      expect(factoryData).toBeDefined()
    })

    test('ECDSA owner throws', () => {
      expect(() =>
        getDeployArgs({
          account: { type: 'hca' },
          owners: {
            type: 'ecdsa',
            accounts: [accountA],
          },
        }),
      ).toThrow(AccountConfigurationNotSupportedError)
    })

    test('Passkey owner throws', () => {
      expect(() =>
        getDeployArgs({
          account: { type: 'hca' },
          owners: {
            type: 'passkey',
            accounts: [passkeyAccount],
          },
        }),
      ).toThrow(AccountConfigurationNotSupportedError)
    })

    test('extra modules throw', () => {
      expect(() =>
        getDeployArgs({
          account: { type: 'hca' },
          owners: {
            type: 'ens',
            owners: [{ account: accountA }],
          },
          modules: [
            {
              address: MOCK_MODULE_ADDRESS,
              initData: '0x',
              type: 'validator',
            },
          ],
        }),
      ).toThrow(AccountConfigurationNotSupportedError)
    })

    test('sessions throw', () => {
      expect(() =>
        getDeployArgs({
          account: { type: 'hca' },
          owners: {
            type: 'ens',
            owners: [{ account: accountA }],
          },
          experimental_sessions: { enabled: true },
        }),
      ).toThrow(AccountConfigurationNotSupportedError)
    })

    test('initData with factory round-trips correctly', () => {
      const deployArgs = getDeployArgs({
        account: { type: 'hca' },
        owners: {
          type: 'ens',
          owners: [{ account: accountA }],
        },
      })
      expect(deployArgs).not.toBeNull()
      const { factory, factoryData } = deployArgs!

      const roundTripped = getDeployArgs({
        account: { type: 'hca' },
        owners: {
          type: 'ens',
          owners: [{ account: accountA }],
        },
        initData: {
          address: '0x229ca553b9863b0c8f2f03d4287cb8c73e2bede7',
          factory,
          factoryData,
          intentExecutorInstalled: true,
        },
      })
      expect(roundTripped).not.toBeNull()
      expect(roundTripped!.factory).toEqual(factory)
      expect(roundTripped!.initializationCallData).toBeDefined()
    })

    test('initData path rejects unsupported config', () => {
      const { factory, factoryData } = getDeployArgs({
        account: { type: 'hca' },
        owners: {
          type: 'ens',
          owners: [{ account: accountA }],
        },
      })!
      expect(() =>
        getDeployArgs({
          account: { type: 'hca' },
          experimental_sessions: { enabled: true },
          initData: {
            address: '0x229ca553b9863b0c8f2f03d4287cb8c73e2bede7',
            factory,
            factoryData,
            intentExecutorInstalled: true,
          },
        }),
      ).toThrow(AccountConfigurationNotSupportedError)
    })

    test('initData without factory returns null', () => {
      const result = getDeployArgs({
        account: { type: 'hca' },
        owners: {
          type: 'ens',
          owners: [{ account: accountA }],
        },
        initData: {
          address: '0x229ca553b9863b0c8f2f03d4287cb8c73e2bede7',
        },
      })
      expect(result).toBeNull()
    })
  })

  describe('Get Address', () => {
    test('CREATE3 derivation is deterministic', () => {
      const address = getAddress({
        account: { type: 'hca' },
        owners: {
          type: 'ens',
          owners: [{ account: accountA }],
        },
      })
      expect(address).toBeDefined()
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)

      // Same config produces same address
      const address2 = getAddress({
        account: { type: 'hca' },
        owners: {
          type: 'ens',
          owners: [{ account: accountA }],
        },
      })
      expect(address).toEqual(address2)
    })

    test('Different primary owners produce different addresses', () => {
      const address1 = getAddress({
        account: { type: 'hca' },
        owners: {
          type: 'ens',
          owners: [{ account: accountA }],
        },
      })
      const address2 = getAddress({
        account: { type: 'hca' },
        owners: {
          type: 'ens',
          owners: [{ account: accountB }],
        },
      })
      expect(address1).not.toEqual(address2)
    })

    test('Owner ordering does not affect the derived address', () => {
      const address1 = getAddress({
        account: { type: 'hca' },
        owners: {
          type: 'ens',
          owners: [{ account: accountA }, { account: accountB }],
          threshold: 2,
        },
      })
      const address2 = getAddress({
        account: { type: 'hca' },
        owners: {
          type: 'ens',
          owners: [{ account: accountB }, { account: accountA }],
          threshold: 2,
        },
      })
      expect(address1).toEqual(address2)
    })

    test('initData with address fallback', () => {
      const expectedAddress = '0x229ca553b9863b0c8f2f03d4287cb8c73e2bede7'
      const address = getAddress({
        account: { type: 'hca' },
        owners: {
          type: 'ens',
          owners: [{ account: accountA }],
        },
        initData: {
          address: expectedAddress,
        },
      })
      expect(address).toEqual(expectedAddress)
    })

    test('factory-backed initData derives the address from factoryData', () => {
      const config = {
        account: { type: 'hca' as const },
        owners: {
          type: 'ens' as const,
          owners: [{ account: accountA }],
        },
      }
      const derived = getAddress(config)
      const { factory, factoryData } = getDeployArgs(config)!

      // A mismatched initData.address must not be trusted.
      const address = getAddress({
        ...config,
        initData: {
          address: '0x000000000000000000000000000000000000dead',
          factory,
          factoryData,
          intentExecutorInstalled: true,
        },
      })
      expect(address).toEqual(derived)
    })
  })

  describe('Get Install Data', () => {
    test('Module', () => {
      const installData = getInstallData({
        address: MOCK_MODULE_ADDRESS,
        initData: '0xabcd',
        type: MODULE_TYPE_ID_VALIDATOR,
        deInitData: '0x0000',
        additionalContext: '0x0000',
      })
      expect(installData).toEqual(
        '0x9517e29f000000000000000000000000000000000000000000000000000000000000000100000000000000000000000028de6501fa86f2e6cd0b33c3aabdaeb4a1b93f3f00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000002abcd000000000000000000000000000000000000000000000000000000000000',
      )
    })
  })

  describe('Get Packed Signature', () => {
    test('Non-default validator includes address', async () => {
      const mockSignature = '0x1234'
      const validator = {
        address: '0xe35b75e5ec3c04e9cefa8e581fbee859f56edeb4' as Address,
        isRoot: true,
      }
      const signature = await packSignature(mockSignature, validator)
      expect(signature).toEqual(
        '0xe35b75e5ec3c04e9cefa8e581fbee859f56edeb41234',
      )
    })

    test('Default ENS validator packs as zero address', async () => {
      const mockSignature = '0x1234'
      const validator = {
        address: ENS_HCA_MODULE,
        isRoot: true,
      }
      const signature = await packSignature(mockSignature, validator)
      expect(signature).toEqual(
        '0x00000000000000000000000000000000000000001234',
      )
    })
  })
})
