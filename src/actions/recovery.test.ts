import { createPublicClient } from 'viem'
import { base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA, accountB, accountC, accountD } from '../../test/consts'
import { RhinestoneSDK } from '..'
import { resolveCallInputs } from '../execution/utils'
import {
  recoverEcdsaOwnership as recover,
  enable as setUpRecovery,
} from './recovery'

const accountAddress = '0x36C03e7D593F7B2C6b06fC18B5f4E9a4A29C99b0'

// Mock viem
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    // @ts-ignore
    ...actual,
    createPublicClient: vi.fn(),
  }
})

describe('Recovery Actions', () => {
  describe('Set Up Recovery', async () => {
    const rhinestone = new RhinestoneSDK()
    const rhinestoneAccount = await rhinestone.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
    })

    test('Single Guardian', async () => {
      const calls = await resolveCallInputs(
        [
          setUpRecovery({
            guardians: [accountB],
            threshold: 1,
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
          data: '0x9517e29f0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000a04d053b3c8021e8d5bf641816c42daa75d8b597000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000010000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7',
        },
      ])
    })

    test('Guardian Multi-Sig', async () => {
      const calls = await resolveCallInputs(
        [
          setUpRecovery({
            guardians: [accountB, accountC, accountD],
            threshold: 2,
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
          data: '0x9517e29f0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000a04d053b3c8021e8d5bf641816c42daa75d8b597000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000030000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7000000000000000000000000c27b7578151c5ef713c62c65db09763d57ac3596000000000000000000000000c5587d912c862252599b61926adaef316ba06da0',
        },
      ])
    })
  })

  describe('Recover', () => {
    const rhinestone = new RhinestoneSDK()
    const accountPromise = rhinestone.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
    })

    const mockPublicClient = {
      readContract: vi.fn(),
      multicall: vi.fn(),
    }

    beforeEach(() => {
      const createPublicClientMock = createPublicClient as any
      createPublicClientMock.mockReturnValue(mockPublicClient)
      vi.clearAllMocks()
    })

    test('1/1 Owners - Single owner to different single owner', async () => {
      const rhinestoneAccount = await accountPromise
      // Initial state
      mockPublicClient.multicall.mockResolvedValueOnce([
        { result: [accountA.address.toLowerCase()], status: 'success' },
        { result: 1n, status: 'success' },
      ])

      const newOwners = {
        type: 'ecdsa' as const,
        accounts: [accountB],
        threshold: 1,
      }

      const result = await resolveCallInputs(
        [recover(newOwners)],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )

      expect(mockPublicClient.multicall).toHaveBeenCalledTimes(1)
      expect(result).toEqual([
        {
          to: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
          value: 0n,
          data: '0x7065cb480000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7',
        },
        {
          to: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
          value: 0n,
          data: '0xfbe5ce0a0000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936',
        },
      ])
    })

    test('1/N Owners - Single owner to multiple owners', async () => {
      const rhinestoneAccount = await accountPromise
      // Initial state
      mockPublicClient.multicall.mockResolvedValueOnce([
        {
          result: [
            accountA.address.toLowerCase(),
            accountB.address.toLowerCase(),
            accountC.address.toLowerCase(),
          ],
          status: 'success',
        },
        { result: 1n, status: 'success' },
      ])

      const newOwners = {
        type: 'ecdsa' as const,
        accounts: [accountB, accountC, accountD],
        threshold: 1,
      }

      const result = await resolveCallInputs(
        [recover(newOwners)],
        rhinestoneAccount.config,
        base,
        accountAddress,
      )

      expect(mockPublicClient.multicall).toHaveBeenCalledTimes(1)
      expect(result).toEqual([
        {
          to: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
          value: 0n,
          data: '0x7065cb48000000000000000000000000c5587d912c862252599b61926adaef316ba06da0',
        },
        {
          to: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
          value: 0n,
          data: '0xfbe5ce0a000000000000000000000000c5587d912c862252599b61926adaef316ba06da0000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936',
        },
      ])
    })

    test('M/N Owners - Multiple owners to different multiple owners', async () => {
      const rhinestoneAccount = await accountPromise
      // Initial state
      mockPublicClient.multicall.mockResolvedValueOnce([
        {
          result: [
            accountA.address.toLowerCase(),
            accountB.address.toLowerCase(),
            accountC.address.toLowerCase(),
          ],
          status: 'success',
        },
        { result: 2n, status: 'success' },
      ])

      const newOwners = {
        type: 'ecdsa' as const,
        accounts: [accountB, accountD],
        threshold: 2,
      }

      const result = await resolveCallInputs(
        [recover(newOwners)],
        rhinestoneAccount.config,
        base,
        accountAddress as any,
      )

      expect(mockPublicClient.multicall).toHaveBeenCalledTimes(1)
      expect(result).toEqual([
        {
          to: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
          value: 0n,
          data: '0x7065cb48000000000000000000000000c5587d912c862252599b61926adaef316ba06da0',
        },
        {
          to: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
          value: 0n,
          data: '0xfbe5ce0a000000000000000000000000c5587d912c862252599b61926adaef316ba06da0000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936',
        },
        {
          to: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
          value: 0n,
          data: '0xfbe5ce0a0000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7000000000000000000000000c27b7578151c5ef713c62c65db09763d57ac3596',
        },
      ])
    })
  })
})
