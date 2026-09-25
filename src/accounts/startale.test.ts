import type { Address } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA, accountB, passkeyAccount } from '../../test/consts'
import { MODULE_TYPE_ID_VALIDATOR } from '../modules/common'
import { AccountConfigurationNotSupportedError } from './error'
import {
  getAddress,
  getDeployArgs,
  getEip712Domain,
  getInstallData,
  K1_DEFAULT_VALIDATOR_ADDRESS,
  packSignature,
} from './startale'

const MOCK_MODULE_ADDRESS = '0x28de6501fa86f2e6cd0b33c3aabdaeb4a1b93f3f'

describe('Accounts: Startale', () => {
  describe('Deploy Args', () => {
    test('ECDSA owner (ownable, 1.0.0)', () => {
      const result = getDeployArgs({
        account: {
          type: 'startale',
          version: '1.0.0',
        },
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
        },
      })
      expect(result).not.toBeNull()
      const {
        factory,
        factoryData,
        salt,
        implementation,
        initializationCallData,
      } = result!

      expect(factory).toEqual('0x0000003b3e7b530b4f981ae80d9350392defef90')
      expect(factoryData).toEqual(
        '0xea6d13ac000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000380000000000000000000000000000000552a5fae3db7a8f3917c435448f49ba6a9000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000003040984b2f700000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000001c0000000000000000000000000000000000000000000000000000000000000026000000000000000000000000000000000000000000000000000000000000002c000000000000000000000000000000000000000000000000000000000000002e000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000013fdb5234e4e3162a810f54d9f7e9800000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000f6c02c78ded62973b43bfa523b247da0994869360000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000005ad9ce1f5035fd62ca96cef16adaaf000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      )
      expect(salt).toEqual(
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      )
      expect(implementation).toEqual(
        '0x000000b8f5f723a680d3d7ee624fe0bc84a6e05a',
      )
      expect(initializationCallData).toEqual(
        '0x4b6a141900000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000380000000000000000000000000000000552a5fae3db7a8f3917c435448f49ba6a9000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000003040984b2f700000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000001c0000000000000000000000000000000000000000000000000000000000000026000000000000000000000000000000000000000000000000000000000000002c000000000000000000000000000000000000000000000000000000000000002e000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000013fdb5234e4e3162a810f54d9f7e9800000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000f6c02c78ded62973b43bfa523b247da0994869360000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000005ad9ce1f5035fd62ca96cef16adaaf000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      )
    })

    test('ECDSA owner with K1 module override (1.0.0)', () => {
      const result = getDeployArgs({
        account: {
          type: 'startale',
          version: '1.0.0',
        },
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
          module: K1_DEFAULT_VALIDATOR_ADDRESS,
        },
      })
      expect(result).not.toBeNull()
      const {
        factory,
        factoryData,
        salt,
        implementation,
        initializationCallData,
      } = result!

      expect(factory).toEqual('0x0000003b3e7b530b4f981ae80d9350392defef90')
      expect(factoryData).toEqual(
        '0xea6d13ac000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000552a5fae3db7a8f3917c435448f49ba6a9000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000002845888596b00000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001c0000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000002600000000000000000000000000000000000000000000000000000000000000014F6C02c78Ded62973b43bfa523B247dA09948693600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000005ad9ce1f5035fd62ca96cef16adaaf0000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      )
      expect(salt).toEqual(
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      )
      expect(implementation).toEqual(
        '0x000000b8f5f723a680d3d7ee624fe0bc84a6e05a',
      )
      expect(initializationCallData).toEqual(
        '0x4b6a141900000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000552a5fae3db7a8f3917c435448f49ba6a9000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000002845888596b00000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001c0000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000002600000000000000000000000000000000000000000000000000000000000000014F6C02c78Ded62973b43bfa523B247dA09948693600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000005ad9ce1f5035fd62ca96cef16adaaf0000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      )
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

    test('Passkey owner (default/ownable)', () => {
      const result = getDeployArgs({
        account: {
          type: 'startale',
        },
        owners: {
          type: 'passkey',
          accounts: [passkeyAccount],
        },
      })
      expect(result).not.toBeNull()
    })

    test('Multiple ECDSA owners (default/ownable)', () => {
      const result = getDeployArgs({
        account: {
          type: 'startale',
        },
        owners: {
          type: 'ecdsa',
          accounts: [accountA, accountB],
        },
      })
      expect(result).not.toBeNull()
    })

    test('Multiple ECDSA owners with K1 throws', () => {
      expect(() =>
        getDeployArgs({
          account: {
            type: 'startale',
          },
          owners: {
            type: 'ecdsa',
            accounts: [accountA, accountB],
            module: K1_DEFAULT_VALIDATOR_ADDRESS,
          },
        }),
      ).toThrow(AccountConfigurationNotSupportedError)
    })
  })

  describe('Get Address', () => {
    test('ECDSA owner (ownable, 1.0.0)', () => {
      const address = getAddress({
        account: {
          type: 'startale',
          version: '1.0.0',
        },
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
        },
      })
      expect(address).toEqual('0x8cdf27ccdec0ae54029a67b2edb5391e438aa023')
    })

    test('ECDSA owner with K1 module override (1.0.0)', () => {
      const address = getAddress({
        account: {
          type: 'startale',
          version: '1.0.0',
        },
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
          module: K1_DEFAULT_VALIDATOR_ADDRESS,
        },
      })
      expect(address).toEqual('0x6fb07864cb69042593710c67742602adc53ac191')
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

    // Expected addresses match the on-chain 1.0.1 factory's computeAccountAddress.
    test('ECDSA owner (1.0.1, default)', () => {
      const previous = getDeployArgs({
        account: { type: 'startale', version: '1.0.0' },
        owners: { type: 'ecdsa', accounts: [accountA] },
      })
      const byDefault = getDeployArgs({
        account: { type: 'startale' },
        owners: { type: 'ecdsa', accounts: [accountA] },
      })
      const deployArgs = getDeployArgs({
        account: { type: 'startale', version: '1.0.1' },
        owners: { type: 'ecdsa', accounts: [accountA] },
      })
      expect(deployArgs).not.toBeNull()
      expect(deployArgs!.factory).toEqual(
        '0x00000be75c267efe9ddd7044d1f236959af4c15f',
      )
      expect(deployArgs!.implementation).toEqual(
        '0x000006b2874cf8a9bbe24fa1c3a32225ae826951',
      )
      expect(byDefault).toEqual(deployArgs)
      // Only the implementation + factory change; the bootstrap calldata doesn't.
      expect(deployArgs!.factoryData).toEqual(previous!.factoryData)

      const address = getAddress({
        account: { type: 'startale', version: '1.0.1' },
        owners: { type: 'ecdsa', accounts: [accountA] },
      })
      expect(address).toEqual('0x63ade81e8e3aa4aed3094c4bf8a42bdfb60e4799')
    })

    test('ECDSA owner with K1 module override (1.0.1)', () => {
      const address = getAddress({
        account: { type: 'startale', version: '1.0.1' },
        owners: {
          type: 'ecdsa',
          accounts: [accountA],
          module: K1_DEFAULT_VALIDATOR_ADDRESS,
        },
      })
      expect(address).toEqual('0x8bc2280c2a1bd7eeff6afda8fd6e80fe0f354011')
    })

    test('Passkey owner (1.0.1)', () => {
      const address = getAddress({
        account: { type: 'startale', version: '1.0.1' },
        owners: { type: 'passkey', accounts: [passkeyAccount] },
      })
      expect(address).toEqual('0x81ee09ada0db875f570ebd9a7d3db841f1dd1848')
    })

    test('initData with 1.0.1 factory resolves the 1.0.1 implementation', () => {
      const config = {
        account: { type: 'startale', version: '1.0.1' },
        owners: { type: 'ecdsa', accounts: [accountA] },
      } as const
      const direct = getAddress(config)
      const { factory, factoryData } = getDeployArgs(config)!

      // No version on the account: the factory alone pins 1.0.1.
      const fromInitData = {
        account: { type: 'startale' },
        owners: { type: 'ecdsa', accounts: [accountA] },
        initData: { address: direct, factory, factoryData },
      } as const
      expect(getDeployArgs(fromInitData)!.implementation).toEqual(
        '0x000006b2874cf8a9bbe24fa1c3a32225ae826951',
      )
      expect(getAddress(fromInitData)).toEqual(direct)
      expect(getEip712Domain(fromInitData, base).version).toEqual('1.0.1')
    })

    test('initData with 1.0.0 factory keeps 1.0.0 without a version', () => {
      const config = {
        account: { type: 'startale', version: '1.0.0' },
        owners: { type: 'ecdsa', accounts: [accountA] },
      } as const
      const direct = getAddress(config)
      const { factory, factoryData } = getDeployArgs(config)!

      // A persisted 1.0.0 account restores against 1.0.0 even though the
      // default is now 1.0.1.
      const fromInitData = {
        account: { type: 'startale' },
        owners: { type: 'ecdsa', accounts: [accountA] },
        initData: { address: direct, factory, factoryData },
      } as const
      expect(getDeployArgs(fromInitData)!.implementation).toEqual(
        '0x000000b8f5f723a680d3d7ee624fe0bc84a6e05a',
      )
      expect(getAddress(fromInitData)).toEqual(
        '0x8cdf27ccdec0ae54029a67b2edb5391e438aa023',
      )
      expect(getEip712Domain(fromInitData, base).version).toEqual('1.0.0')
    })
  })

  describe('Get EIP-712 Domain', () => {
    test('Defaults to 1.0.1', () => {
      const domain = getEip712Domain(
        {
          account: { type: 'startale' },
          owners: { type: 'ecdsa', accounts: [accountA] },
        },
        base,
      )
      expect(domain).toEqual({
        name: 'Startale',
        version: '1.0.1',
        chainId: base.id,
        verifyingContract: '0x63ade81e8e3aa4aed3094c4bf8a42bdfb60e4799',
        salt: '0x0000000000000000000000000000000000000000000000000000000000000000',
      })
    })

    test('1.0.0', () => {
      const domain = getEip712Domain(
        {
          account: { type: 'startale', version: '1.0.0' },
          owners: { type: 'ecdsa', accounts: [accountA] },
        },
        base,
      )
      expect(domain.version).toEqual('1.0.0')
      expect(domain.verifyingContract).toEqual(
        '0x8cdf27ccdec0ae54029a67b2edb5391e438aa023',
      )
    })

    test('Address-only initData uses the configured version', () => {
      const address = '0x229ca553b9863b0c8f2f03d4287cb8c73e2bede7'
      const domain = (version?: '1.0.0' | '1.0.1') =>
        getEip712Domain(
          {
            account: { type: 'startale', version },
            owners: { type: 'ecdsa', accounts: [accountA] },
            initData: { address },
          },
          base,
        )
      expect(domain().version).toEqual('1.0.1')
      expect(domain('1.0.0').version).toEqual('1.0.0')
      expect(domain('1.0.0').verifyingContract).toEqual(address)
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
