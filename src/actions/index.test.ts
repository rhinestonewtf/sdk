import { Address, Chain, createPublicClient } from 'viem'
import { base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  accountA,
  accountB,
  accountC,
  accountD,
  MOCK_API_KEY,
  passkeyAccount,
} from '../../test/consts'
import { createRhinestoneAccount } from '..'
import {
  addOwner,
  changeThreshold,
  disableEcdsa,
  disablePasskeys,
  enableEcdsa,
  enablePasskeys,
  recover,
  removeOwner,
  setUpRecovery,
} from '.'

const MOCK_OWNER_A = '0xd1aefebdceefc094f1805b241fa5e6db63a9181a'
const MOCK_OWNER_B = '0xeddfcb50d18f6d3d51c4f7cbca5ed6bdebc59817'
const MOCK_OWNER_C = '0xb31e76f19defe76edc4b7eceeb4b0a2d6ddaca39'
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
  describe('Install Ownable Validator', async () => {
    const rhinestoneAccount = await createRhinestoneAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
      rhinestoneApiKey: MOCK_API_KEY,
    })

    test('1/1 Owners', () => {
      expect(
        enableEcdsa({
          rhinestoneAccount,
          owners: [MOCK_OWNER_A],
        }),
      ).toEqual([
        {
          to: '0x27d66c2e6b33579ee108206c4bc8f66bb655e69f',
          data: '0x9517e29f00000000000000000000000000000000000000000000000000000000000000010000000000000000000000002483da3a338895199e5e538530213157e931bf0600000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000d1aefebdceefc094f1805b241fa5e6db63a9181a',
        },
      ])
    })

    test('1/N Owners', () => {
      expect(
        enableEcdsa({
          rhinestoneAccount,
          owners: [MOCK_OWNER_A, MOCK_OWNER_B],
        }),
      ).toEqual([
        {
          to: '0x27d66c2e6b33579ee108206c4bc8f66bb655e69f',
          data: '0x9517e29f00000000000000000000000000000000000000000000000000000000000000010000000000000000000000002483da3a338895199e5e538530213157e931bf06000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000002000000000000000000000000d1aefebdceefc094f1805b241fa5e6db63a9181a000000000000000000000000eddfcb50d18f6d3d51c4f7cbca5ed6bdebc59817',
        },
      ])
    })

    test('M/N Owners', () => {
      expect(
        enableEcdsa({
          rhinestoneAccount,
          owners: [MOCK_OWNER_A, MOCK_OWNER_B, MOCK_OWNER_C],
          threshold: 2,
        }),
      ).toEqual([
        {
          to: '0x27d66c2e6b33579ee108206c4bc8f66bb655e69f',
          data: '0x9517e29f00000000000000000000000000000000000000000000000000000000000000010000000000000000000000002483da3a338895199e5e538530213157e931bf06000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000003000000000000000000000000b31e76f19defe76edc4b7eceeb4b0a2d6ddaca39000000000000000000000000d1aefebdceefc094f1805b241fa5e6db63a9181a000000000000000000000000eddfcb50d18f6d3d51c4f7cbca5ed6bdebc59817',
        },
      ])
    })
  })

  describe('Install WebAuthn Validator', async () => {
    const rhinestoneAccount = await createRhinestoneAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
      rhinestoneApiKey: MOCK_API_KEY,
    })

    test('', () => {
      expect(
        enablePasskeys({
          rhinestoneAccount,
          pubKey: passkeyAccount.publicKey,
          authenticatorId: passkeyAccount.id,
        }),
      ).toEqual([
        {
          to: '0x27d66c2e6b33579ee108206c4bc8f66bb655e69f',
          data: '0x9517e29f00000000000000000000000000000000000000000000000000000000000000010000000000000000000000002f167e55d42584f65e2e30a748f41ee75a31141400000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000060580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d3737637d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d19c9a01073b202db2ed56e604ad11db557d8c3ad75181619597f21b830f2da82a',
        },
      ])
    })
  })

  describe('Uninstall Ownable Validator', async () => {
    const rhinestoneAccount = await createRhinestoneAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
      rhinestoneApiKey: MOCK_API_KEY,
    })

    test('', () => {
      expect(
        disableEcdsa({
          rhinestoneAccount,
        }),
      ).toEqual([
        {
          to: '0x27d66c2e6b33579ee108206c4bc8f66bb655e69f',
          data: '0xa71763a800000000000000000000000000000000000000000000000000000000000000010000000000000000000000002483da3a338895199e5e538530213157e931bf0600000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000',
        },
      ])
    })
  })

  describe('Uninstall WebAuthn Validator', async () => {
    const rhinestoneAccount = await createRhinestoneAccount({
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
      rhinestoneApiKey: MOCK_API_KEY,
    })

    test('', () => {
      expect(
        disablePasskeys({
          rhinestoneAccount,
        }),
      ).toEqual([
        {
          to: '0x27d66c2e6b33579ee108206c4bc8f66bb655e69f',
          data: '0xa71763a800000000000000000000000000000000000000000000000000000000000000010000000000000000000000002f167e55d42584f65e2e30a748f41ee75a31141400000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000',
        },
      ])
    })
  })

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
      expect(changeThreshold(1)).toEqual({
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
      multicall: vi.fn(),
    }

    beforeEach(() => {
      const createPublicClientMock = createPublicClient as any
      createPublicClientMock.mockReturnValue(mockPublicClient)
      vi.clearAllMocks()
    })

    test('1/1 Owners - Single owner to different single owner', async () => {
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

      const result = await recover(
        MOCK_ACCOUNT_ADDRESS as Address,
        newOwners,
        base as Chain,
      )

      expect(mockPublicClient.multicall).toHaveBeenCalledTimes(1)
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

      const result = await recover(
        MOCK_ACCOUNT_ADDRESS as Address,
        newOwners,
        base as Chain,
      )

      expect(mockPublicClient.multicall).toHaveBeenCalledTimes(1)
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

      const result = await recover(
        MOCK_ACCOUNT_ADDRESS as Address,
        newOwners,
        base as Chain,
      )

      expect(mockPublicClient.multicall).toHaveBeenCalledTimes(1)
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
