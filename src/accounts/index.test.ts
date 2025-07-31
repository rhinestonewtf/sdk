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
      expect(address).toEqual('0xa32fa78416f6c68ce4f75f702e07849a269feffb')
    })
    test('Safe, passkey owner with a session', () => {
      const address = getAddress({
        owners: {
          type: 'passkey',
          account: passkeyAccount,
        },
        rhinestoneApiKey: MOCK_API_KEY,
      })
      expect(address).toEqual('0xfbda4e576b2a300cd1b7e8748c9a7577ab3a503e')
    })
  })

  describe('Sign', () => {
    test.todo('With ECDSA, single key')
    test.todo('With ECDSA, multisig')
    test.todo('With Passkey')
  })
})
