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
      expect(address).toEqual('0xdfcac1d28f7f3ea8776abb45312d1648e1d0448c')
    })
    test('Safe, passkey owner with a session', () => {
      const address = getAddress({
        owners: {
          type: 'passkey',
          account: passkeyAccount,
        },
        rhinestoneApiKey: MOCK_API_KEY,
      })
      expect(address).toEqual('0x0680f5e1cf71d32615f1ab14045e45ebec711560')
    })
  })

  describe('Sign', () => {
    test.todo('With ECDSA, single key')
    test.todo('With ECDSA, multisig')
    test.todo('With Passkey')
  })
})
