import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../test/consts'
import { RhinestoneSDK } from '..'
import { resolveCallInputs } from '../execution/utils'
import {
  addOwner,
  changeThreshold,
  disable as disableEcdsa,
  enable as enableEcdsa,
  removeOwner,
} from './ecdsa'

const MOCK_OWNER_A = '0xd1aefebdceefc094f1805b241fa5e6db63a9181a'
const MOCK_OWNER_B = '0xeddfcb50d18f6d3d51c4f7cbca5ed6bdebc59817'
const MOCK_OWNER_C = '0xb31e76f19defe76edc4b7eceeb4b0a2d6ddaca39'
const accountAddress = '0x36C03e7D593F7B2C6b06fC18B5f4E9a4A29C99b0'

describe('ECDSA Actions', () => {
  describe('Install Ownable Validator', async () => {
    const rhinestone = new RhinestoneSDK({ apiKey: 'test' })
    const rhinestoneAccount = await rhinestone.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
    })

    test('1/1 Owners', async () => {
      const calls = await resolveCallInputs(
        [enableEcdsa([MOCK_OWNER_A])],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )
      expect(calls).toEqual([
        {
          to: accountAddress,
          value: 0n,
          data: '0x9517e29f0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000013fdb5234e4e3162a810f54d9f7e9800000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000d1aefebdceefc094f1805b241fa5e6db63a9181a',
        },
      ])
    })

    test('1/N Owners', async () => {
      const calls = await resolveCallInputs(
        [enableEcdsa([MOCK_OWNER_A, MOCK_OWNER_B])],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )
      expect(calls).toEqual([
        {
          to: accountAddress,
          value: 0n,
          data: '0x9517e29f0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000013fdb5234e4e3162a810f54d9f7e98000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000002000000000000000000000000d1aefebdceefc094f1805b241fa5e6db63a9181a000000000000000000000000eddfcb50d18f6d3d51c4f7cbca5ed6bdebc59817',
        },
      ])
    })

    test('M/N Owners', async () => {
      const calls = await resolveCallInputs(
        [enableEcdsa([MOCK_OWNER_A, MOCK_OWNER_B, MOCK_OWNER_C], 2)],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )
      expect(calls).toEqual([
        {
          to: accountAddress,
          value: 0n,
          data: '0x9517e29f0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000013fdb5234e4e3162a810f54d9f7e98000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000003000000000000000000000000b31e76f19defe76edc4b7eceeb4b0a2d6ddaca39000000000000000000000000d1aefebdceefc094f1805b241fa5e6db63a9181a000000000000000000000000eddfcb50d18f6d3d51c4f7cbca5ed6bdebc59817',
        },
      ])
    })
  })

  describe('Uninstall Ownable Validator', async () => {
    const rhinestone = new RhinestoneSDK({ apiKey: 'test' })
    const rhinestoneAccount = await rhinestone.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
    })

    test('', async () => {
      const calls = await resolveCallInputs(
        [disableEcdsa()],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )
      expect(calls).toEqual([
        {
          to: accountAddress,
          value: 0n,
          data: '0xa71763a80000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000013fdb5234e4e3162a810f54d9f7e9800000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000',
        },
      ])
    })
  })

  describe('Add Owner', () => {
    test('', () => {
      expect(addOwner(MOCK_OWNER_A)).toEqual({
        to: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
        value: 0n,
        data: '0x7065cb48000000000000000000000000d1aefebdceefc094f1805b241fa5e6db63a9181a',
      })
    })
  })

  describe('Remove Owner', () => {
    test('', () => {
      expect(removeOwner(MOCK_OWNER_A, MOCK_OWNER_B)).toEqual({
        to: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
        value: 0n,
        data: '0xfbe5ce0a000000000000000000000000d1aefebdceefc094f1805b241fa5e6db63a9181a000000000000000000000000eddfcb50d18f6d3d51c4f7cbca5ed6bdebc59817',
      })
    })
  })

  describe('Set Threshold', () => {
    test('', () => {
      expect(changeThreshold(1)).toEqual({
        to: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
        value: 0n,
        data: '0x960bfe040000000000000000000000000000000000000000000000000000000000000001',
      })
    })
  })
})
