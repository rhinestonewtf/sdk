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
      expect(address).toEqual('0x0f955bab1e26a3e94d6980a3969c58341944e597')
    })
    test('Safe, passkey owner with a session', () => {
      const address = getAddress({
        owners: {
          type: 'passkey',
          account: passkeyAccount,
        },
        rhinestoneApiKey: MOCK_API_KEY,
      })
      expect(address).toEqual('0x0fc657491a59242bc9145c308b201a05f25ce567')
    })
  })

  describe('Sign', () => {
    test.todo('With ECDSA, single key')
    test.todo('With ECDSA, multisig')
    test.todo('With Passkey')
  })
})
