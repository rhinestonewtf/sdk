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
        '0x20C008719Ba9D8aA14C7d07D122cd5E965aA8da5',
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
        '0x20C008719Ba9D8aA14C7d07D122cd5E965aA8da5',
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
        '0x20C008719Ba9D8aA14C7d07D122cd5E965aA8da5',
      )
      expect(validator.initData).toEqual(
        '0x0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000030000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7000000000000000000000000c27b7578151c5ef713c62c65db09763d57ac3596000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936',
      )
    })

    test('Passkey', () => {
      const validator = getValidator({
        type: 'passkey',
        accounts: [passkeyAccount],
      })
      expect(validator.type).toEqual(MODULE_TYPE_ID_VALIDATOR)
      expect(isAddress(validator.address)).toEqual(true)
      expect(validator.address).toEqual(
        '0x0000000000578c4cB0e472a5462da43C495C3F33',
      )
      expect(validator.initData).toEqual(
        '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d3737637d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d10000000000000000000000000000000000000000000000000000000000000000',
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
        accounts: [passkeyAccount],
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
