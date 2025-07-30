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
      expect(address).toEqual('0xd06bfe831a0ca93690fd0d8cd719097bb6cff155')
    })
    test('Safe, passkey owner with a session', () => {
      const address = getAddress({
        owners: {
          type: 'passkey',
          account: passkeyAccount,
        },
        rhinestoneApiKey: MOCK_API_KEY,
      })
      expect(address).toEqual('0xff7d919df4eb86685e50c46cd170806ce0371f17')
    })
  })

  describe('Sign', () => {
    test.todo('With ECDSA, single key')
    test.todo('With ECDSA, multisig')
    test.todo('With Passkey')
  })
})
