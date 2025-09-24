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
      expect(address).toEqual('0x0681de31e060b384F0b08A3bAC99E9bDFf302474')
    })
    test('Safe, passkey owner with a session', () => {
      const address = getAddress({
        owners: {
          type: 'passkey',
          accounts: [passkeyAccount],
        },
      })
      expect(address).toEqual('0x894b88C04B4DE6AbDdcE81E8bdc91927E37d6ceD')
    })
  })

  describe('Sign', () => {
    test.todo('With ECDSA, single key')
    test.todo('With ECDSA, multisig')
    test.todo('With Passkey')
  })
})
