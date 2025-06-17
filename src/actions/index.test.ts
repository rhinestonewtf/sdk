import { Address, Chain, createPublicClient } from 'viem'
import { base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  accountA,
  accountB,
  accountC,
  accountD,
  MOCK_API_KEY,
} from '../../test/consts'
import { createRhinestoneAccount } from '..'
import { OWNABLE_VALIDATOR_ADDRESS } from '../modules/validators/core'
import { addOwner, recover, removeOwner, setThreshold, setUpRecovery } from '.'

const MOCK_OWNER_A = '0xd1aefebdceefc094f1805b241fa5e6db63a9181a'
const MOCK_OWNER_B = '0xeddfcb50d18f6d3d51c4f7cbca5ed6bdebc59817'
const MOCK_ACCOUNT_ADDRESS = '0x1234567890123456789012345678901234567890'

// Mock viem
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    // @ts-ignore
    ...actual,
    createPublicClient: vi.fn(),
  }
})

describe('Actions', () => {
  describe('Add Owner', () => {
    test('', () => {
      expect(addOwner(MOCK_OWNER_A)).toEqual({
        to: '0x2483DA3A338895199E5e538530213157e931Bf06',
        data: '0x7065cb48000000000000000000000000d1aefebdceefc094f1805b241fa5e6db63a9181a',
      })
    })
  })

  describe('Remove Owner', () => {
    test('', () => {
      expect(removeOwner(MOCK_OWNER_A, MOCK_OWNER_B)).toEqual({
        to: '0x2483DA3A338895199E5e538530213157e931Bf06',
        data: '0xfbe5ce0a000000000000000000000000d1aefebdceefc094f1805b241fa5e6db63a9181a000000000000000000000000eddfcb50d18f6d3d51c4f7cbca5ed6bdebc59817',
      })
    })
  })

  describe('Set Threshold', () => {
    test('', () => {
      expect(setThreshold(1n)).toEqual({
        to: '0x2483DA3A338895199E5e538530213157e931Bf06',
        data: '0x960bfe040000000000000000000000000000000000000000000000000000000000000001',
      })
    })
  })

  describe('Set Up Recovery', async () => {
    const rhinestoneAccount = await createRhinestoneAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
      rhinestoneApiKey: MOCK_API_KEY,
    })

    test('Single Guardian', () => {
      expect(
        setUpRecovery({
          rhinestoneAccount,
          guardians: [accountB],
          threshold: 1,
        }),
      ).toEqual([
        {
          to: '0x27d66c2e6b33579ee108206c4bc8f66bb655e69f',
          data: '0x9517e29f0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000a04d053b3c8021e8d5bf641816c42daa75d8b597000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000010000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7',
        },
      ])
    })

    test('Guardian Multi-Sig', () => {
      expect(
        setUpRecovery({
          rhinestoneAccount,
          guardians: [accountB, accountC, accountD],
          threshold: 2,
        }),
      ).toEqual([
        {
          to: '0x27d66c2e6b33579ee108206c4bc8f66bb655e69f',
          data: '0x9517e29f0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000a04d053b3c8021e8d5bf641816c42daa75d8b597000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000030000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7000000000000000000000000c27b7578151c5ef713c62c65db09763d57ac3596000000000000000000000000c5587d912c862252599b61926adaef316ba06da0',
        },
      ])
    })
  })

  describe('Recover', () => {
    const mockPublicClient = {
      readContract: vi.fn(),
    }

    beforeEach(() => {
      const createPublicClientMock = createPublicClient as any
      createPublicClientMock.mockReturnValue(mockPublicClient)
      vi.clearAllMocks()
    })

    test('1/1 Owners - Single owner to different single owner', async () => {
      // Initial state
      mockPublicClient.readContract
        .mockResolvedValueOnce([accountA.address.toLowerCase()])
        .mockResolvedValueOnce(1n)

      const newOwners = {
        type: 'ecdsa' as const,
        accounts: [accountB],
        threshold: 1,
      }

      const result = await recover(
        MOCK_ACCOUNT_ADDRESS as Address,
        newOwners,
        base as Chain,
      )

      expect(mockPublicClient.readContract).toHaveBeenCalledTimes(2)
      expect(result).toEqual([
        {
          to: '0x2483DA3A338895199E5e538530213157e931Bf06',
          data: '0x7065cb480000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7',
        },
        {
          to: '0x2483DA3A338895199E5e538530213157e931Bf06',
          data: '0xfbe5ce0a0000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936',
        },
      ])
    })

    test('1/N Owners - Single owner to multiple owners', async () => {
      // Initial state
      mockPublicClient.readContract
        .mockResolvedValueOnce([
          accountA.address.toLowerCase(),
          accountB.address.toLowerCase(),
          accountC.address.toLowerCase(),
        ])
        .mockResolvedValueOnce(1n)

      const newOwners = {
        type: 'ecdsa' as const,
        accounts: [accountB, accountC, accountD],
        threshold: 1,
      }

      const result = await recover(
        MOCK_ACCOUNT_ADDRESS as Address,
        newOwners,
        base as Chain,
      )

      expect(mockPublicClient.readContract).toHaveBeenCalledTimes(2)
      expect(result).toEqual([
        {
          to: '0x2483DA3A338895199E5e538530213157e931Bf06',
          data: '0x7065cb48000000000000000000000000c5587d912c862252599b61926adaef316ba06da0',
        },
        {
          to: '0x2483DA3A338895199E5e538530213157e931Bf06',
          data: '0xfbe5ce0a000000000000000000000000c5587d912c862252599b61926adaef316ba06da0000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936',
        },
      ])
    })

    test('M/N Owners - Multiple owners to different multiple owners', async () => {
      // Initial state
      mockPublicClient.readContract
        .mockResolvedValueOnce([
          accountA.address.toLowerCase(),
          accountB.address.toLowerCase(),
          accountC.address.toLowerCase(),
        ])
        .mockResolvedValueOnce(2n)

      const newOwners = {
        type: 'ecdsa' as const,
        accounts: [accountB, accountD],
        threshold: 2,
      }

      const result = await recover(
        MOCK_ACCOUNT_ADDRESS as Address,
        newOwners,
        base as Chain,
      )

      expect(mockPublicClient.readContract).toHaveBeenCalledTimes(2)
      expect(result).toEqual([
        {
          to: '0x2483DA3A338895199E5e538530213157e931Bf06',
          data: '0x7065cb48000000000000000000000000c5587d912c862252599b61926adaef316ba06da0',
        },
        {
          to: '0x2483DA3A338895199E5e538530213157e931Bf06',
          data: '0xfbe5ce0a000000000000000000000000c5587d912c862252599b61926adaef316ba06da0000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936',
        },
        {
          to: '0x2483DA3A338895199E5e538530213157e931Bf06',
          data: '0xfbe5ce0a0000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7000000000000000000000000c27b7578151c5ef713c62c65db09763d57ac3596',
        },
      ])
    })
  })
})
