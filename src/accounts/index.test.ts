import { describe, expect, test } from 'vitest'
import {
  accountA,
  accountB,
  MOCK_API_KEY,
  passkeyAccount,
} from '../../test/consts'
import { getAddress } from '.'

describe('Accounts', () => {
  describe('Get Address', () => {
    test('Nexus, ECDSA owner', () => {
      const address = getAddress({
        owners: {
          type: 'ecdsa',
          accounts: [accountA, accountB],
          threshold: 1,
        },
        rhinestoneApiKey: MOCK_API_KEY,
      })
      expect(address).toEqual('0x31ab511fb2f2f816273cb4daccc3b5a7051d7de9')
    })
    test('Safe, passkey owner with a session', () => {
      const address = getAddress({
        owners: {
          type: 'passkey',
          account: passkeyAccount,
        },
        rhinestoneApiKey: MOCK_API_KEY,
      })
      expect(address).toEqual('0x381c656b20526f5be15d7a908b2743d5ec51bd04')
    })
  })

  describe('Sign', () => {
    test.todo('With ECDSA, single key')
    test.todo('With ECDSA, multisig')
    test.todo('With Passkey')
  })
})
