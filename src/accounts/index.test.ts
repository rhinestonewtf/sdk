import type { Account, Hex } from 'viem'
import { mainnet } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { accountA, accountB, passkeyAccount } from '../../test/consts'
import {
  getQuorumSignableHash,
  getQuorumValidator,
} from '../modules/validators/quorum'
import { getAddress, getEip1271Signature } from '.'
import { wrapMessageHash as wrapKernelMessageHash } from './kernel'

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
    test('Quorum owner order does not affect the account address', () => {
      const module = '0x0000000000000000000000000000000000000042'
      const owners = [
        { account: accountA, weight: 1n },
        { account: accountB, weight: 2n },
      ]

      expect(
        getAddress({
          owners: {
            type: 'quorum',
            owners,
            thresholdWeight: 2n,
            module,
          },
        }),
      ).toBe(
        getAddress({
          owners: {
            type: 'quorum',
            owners: [...owners].reverse(),
            thresholdWeight: 2n,
            module,
          },
        }),
      )
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

    test('Kernel wraps the application hash before Quorum binding', async () => {
      const module = '0x0000000000000000000000000000000000000042'
      const innerSignature = `0x${'11'.repeat(64)}1b` as Hex
      const rawSign = vi.fn().mockResolvedValue(innerSignature)
      const owner = { ...accountA, sign: rawSign } as Account
      const config = {
        account: { type: 'kernel' as const },
        owners: {
          type: 'quorum' as const,
          owners: [{ account: owner, weight: 1n }],
          thresholdWeight: 1n,
          module,
        },
      }
      const account = getAddress(config)
      const hash = `0x${'22'.repeat(32)}` as Hex
      const validator = getQuorumValidator(config.owners)

      await getEip1271Signature(
        config,
        undefined,
        mainnet,
        { address: validator.address, isRoot: true },
        hash,
      )

      expect(rawSign).toHaveBeenCalledWith({
        hash: getQuorumSignableHash({
          validator: module,
          chainId: mainnet.id,
          account,
          hash: wrapKernelMessageHash(hash, account),
        }),
      })
    })
  })
})
