import type { Address } from 'viem'
import { describe, expect, test } from 'vitest'

import { accountA, accountB, passkeyAccount } from '../../test/consts'
import { MODULE_TYPE_ID_VALIDATOR } from '../modules/common'
import { AccountConfigurationNotSupportedError } from './error'
import {
  getAddress,
  getDeployArgs,
  getInstallData,
  K1_DEFAULT_VALIDATOR_ADDRESS,
  packSignature,
} from './startale'

const MOCK_MODULE_ADDRESS = '0x28de6501fa86f2e6cd0b33c3aabdaeb4a1b93f3f'

describe('Accounts: Startale', () => {
  describe('Deploy Args', () => {
    test('ECDSA owner (default/ownable)', () => {
      const result = getDeployArgs({
        account: {
          type: 'startale',
        },
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
        },
      })
      expect(result).not.toBeNull()
      const { factory, salt, implementation, factoryData } = result!

      expect(factory).toEqual('0x0000003b3e7b530b4f981ae80d9350392defef90')
      expect(salt).toEqual(
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      )
      expect(implementation).toEqual(
        '0x000000b8f5f723a680d3d7ee624fe0bc84a6e05a',
      )
      // Uses `init` bootstrap (ownable validator included in validators array)
      expect(factoryData).toContain('0984b2f7') // init selector
    })

    test('ECDSA owner with K1 module override', () => {
      const result = getDeployArgs({
        account: {
          type: 'startale',
        },
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
          module: K1_DEFAULT_VALIDATOR_ADDRESS,
        },
      })
      expect(result).not.toBeNull()
      const { factory, salt, implementation, factoryData } = result!

      expect(factory).toEqual('0x0000003b3e7b530b4f981ae80d9350392defef90')
      expect(salt).toEqual(
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      )
      expect(implementation).toEqual(
        '0x000000b8f5f723a680d3d7ee624fe0bc84a6e05a',
      )
      // Uses `initWithDefaultValidatorAndOtherModules` bootstrap
      expect(factoryData).toContain('5888596b') // initWithDefaultValidatorAndOtherModules selector
    })

    test('Default and K1 produce different addresses', () => {
      const defaultResult = getAddress({
        account: { type: 'startale' },
        owners: { type: 'ecdsa', accounts: [accountA] },
      })
      const k1Result = getAddress({
        account: { type: 'startale' },
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
          module: K1_DEFAULT_VALIDATOR_ADDRESS,
        },
      })
      expect(defaultResult).not.toEqual(k1Result)
    })

    test('Passkey owner throws', () => {
      expect(() =>
        getDeployArgs({
          account: {
            type: 'startale',
          },
          owners: {
            type: 'passkey',
            accounts: [passkeyAccount],
          },
        }),
      ).toThrow(AccountConfigurationNotSupportedError)
    })

    test('Multiple ECDSA owners throws', () => {
      expect(() =>
        getDeployArgs({
          account: {
            type: 'startale',
          },
          owners: {
            type: 'ecdsa',
            accounts: [accountA, accountB],
          },
        }),
      ).toThrow(AccountConfigurationNotSupportedError)
    })
  })

  describe('Get Address', () => {
    test('ECDSA owner (default/ownable)', () => {
      const address = getAddress({
        account: {
          type: 'startale',
        },
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
        },
      })
      expect(address).toMatch(/^0x[0-9a-f]{40}$/)
    })

    test('ECDSA owner with K1 module override', () => {
      const address = getAddress({
        account: {
          type: 'startale',
        },
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
          module: K1_DEFAULT_VALIDATOR_ADDRESS,
        },
      })
      expect(address).toMatch(/^0x[0-9a-f]{40}$/)
    })

    test('initData with address fallback', () => {
      const expectedAddress = '0x229ca553b9863b0c8f2f03d4287cb8c73e2bede7'
      const address = getAddress({
        account: {
          type: 'startale',
        },
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
        },
        initData: {
          address: expectedAddress,
        },
      })
      expect(address).toEqual(expectedAddress)
    })

    test('initData with factory decodes correctly', () => {
      const deployArgs = getDeployArgs({
        account: { type: 'startale' },
        owners: { type: 'ecdsa', accounts: [accountA] },
      })
      expect(deployArgs).not.toBeNull()
      const { factory, factoryData } = deployArgs!

      const addressFromDeploy = getAddress({
        account: { type: 'startale' },
        owners: { type: 'ecdsa', accounts: [accountA] },
      })

      const address = getAddress({
        account: { type: 'startale' },
        owners: { type: 'ecdsa', accounts: [accountA] },
        initData: {
          address: addressFromDeploy,
          factory,
          factoryData,
          intentExecutorInstalled: true,
        },
      })

      expect(address).toEqual(addressFromDeploy)
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
    test('Mock signature', async () => {
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
  })
})
