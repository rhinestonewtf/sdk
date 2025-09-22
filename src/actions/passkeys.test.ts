import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA, passkeyAccount } from '../../test/consts'
import { RhinestoneSDK } from '..'
import { resolveCallIntents } from '../execution/utils'
import {
  disable as disablePasskeys,
  enable as enablePasskeys,
} from './passkeys'

const accountAddress = '0x36C03e7D593F7B2C6b06fC18B5f4E9a4A29C99b0'

describe('Passkeys Actions', () => {
  describe('Install WebAuthn Validator', async () => {
    const rhinestone = new RhinestoneSDK()
    const rhinestoneAccount = await rhinestone.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
    })

    test('', async () => {
      const calls = await resolveCallIntents(
        [
          enablePasskeys({
            pubKey: passkeyAccount.publicKey,
            authenticatorId: passkeyAccount.id,
          }),
        ],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )
      expect(calls).toEqual([
        {
          to: accountAddress,
          value: 0n,
          data: '0x9517e29f00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000578c4cb0e472a5462da43c495c3f33000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d3737637d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d10000000000000000000000000000000000000000000000000000000000000000',
        },
      ])
    })
  })

  describe('Uninstall WebAuthn Validator', async () => {
    const rhinestone = new RhinestoneSDK()
    const rhinestoneAccount = await rhinestone.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
    })

    test('', async () => {
      const calls = await resolveCallIntents(
        [disablePasskeys()],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )
      expect(calls).toEqual([
        {
          to: accountAddress,
          value: 0n,
          data: '0xa71763a800000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000578c4cb0e472a5462da43c495c3f3300000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000',
        },
      ])
    })
  })
})
