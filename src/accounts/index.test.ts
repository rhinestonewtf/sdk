import { describe, expect, test } from 'vitest'
import { accountA, accountB, passkeyAccount } from '../../test/consts'
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
      })
      expect(address).toEqual('0x011ce90AB2e42C509E46bCF72ef12f9FbCa64e7e')
    })
    test('Safe, passkey owner with a session', () => {
      const address = getAddress({
        owners: {
          type: 'passkey',
          accounts: [passkeyAccount],
        },
      })
      expect(address).toEqual('0x68484B775e4a2828A50C7404ce8530f146d5598e')
    })
  })

  describe('Sign', () => {
    test.todo('With ECDSA, single key')
    test.todo('With ECDSA, multisig')
    test.todo('With Passkey')
  })
})
