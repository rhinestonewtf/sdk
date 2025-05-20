import { decodeAbiParameters, isAddress, size } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  accountA,
  accountB,
  accountC,
  passkeyAccount,
} from '../../../test/consts'
import { MODULE_TYPE_ID_VALIDATOR } from '../common'
import { getMockSignature, getValidator } from './core'

describe('Validators Core', () => {
  describe('Validator', () => {
    test('ECDSA: single address', () => {
      const validator = getValidator({
        type: 'ecdsa',
        accounts: [accountA],
      })

      expect(validator.type).toEqual(MODULE_TYPE_ID_VALIDATOR)
      expect(isAddress(validator.address)).toEqual(true)
      expect(validator.address).toEqual(
        '0x2483DA3A338895199E5e538530213157e931Bf06',
      )
      expect(validator.initData).toEqual(
        '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936',
      )
    })

    test('ECDSA: two addresses', () => {
      const validator = getValidator({
        type: 'ecdsa',
        accounts: [accountA, accountB],
      })
      expect(validator.type).toEqual(MODULE_TYPE_ID_VALIDATOR)
      expect(isAddress(validator.address)).toEqual(true)
      expect(validator.address).toEqual(
        '0x2483DA3A338895199E5e538530213157e931Bf06',
      )
      expect(validator.initData).toEqual(
        '0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936',
      )
    })

    test('ECDSA: three addresses, custom threshold', () => {
      const validator = getValidator({
        type: 'ecdsa',
        accounts: [accountA, accountB, accountC],
        threshold: 2,
      })
      expect(validator.type).toEqual(MODULE_TYPE_ID_VALIDATOR)
      expect(isAddress(validator.address)).toEqual(true)
      expect(validator.address).toEqual(
        '0x2483DA3A338895199E5e538530213157e931Bf06',
      )
      expect(validator.initData).toEqual(
        '0x0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000030000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7000000000000000000000000c27b7578151c5ef713c62c65db09763d57ac3596000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936',
      )
    })

    test('Passkey', () => {
      const validator = getValidator({
        type: 'passkey',
        account: passkeyAccount,
      })
      expect(validator.type).toEqual(MODULE_TYPE_ID_VALIDATOR)
      expect(isAddress(validator.address)).toEqual(true)
      expect(validator.address).toEqual(
        '0x2f167e55d42584f65e2e30a748f41ee75a311414',
      )
      expect(validator.initData).toEqual(
        '0x580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d3737637d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d19c9a01073b202db2ed56e604ad11db557d8c3ad75181619597f21b830f2da82a',
      )
    })
  })

  describe('Mock Signature', () => {
    test('ECDSA: single address', () => {
      const signature = getMockSignature({
        type: 'ecdsa',
        accounts: [accountA],
      })
      expect(size(signature)).toEqual(65)
    })

    test('ECDSA: multiple addresses', () => {
      const signature = getMockSignature({
        type: 'ecdsa',
        accounts: [accountA, accountB, accountC],
      })
      expect(size(signature)).toEqual(3 * 65)
    })

    test('Passkey', () => {
      const signature = getMockSignature({
        type: 'passkey',
        account: passkeyAccount,
      })

      // Should have the proper schema
      decodeAbiParameters(
        [
          {
            type: 'bytes',
            name: 'authenticatorData',
          },
          {
            type: 'string',
            name: 'clientDataJSON',
          },
          {
            type: 'uint256',
            name: 'challengeIndex',
          },
          {
            type: 'uint256',
            name: 'typeIndex',
          },
          {
            type: 'uint256',
            name: 'r',
          },
          {
            type: 'uint256',
            name: 's',
          },
        ],
        signature,
      )
    })
  })
})
