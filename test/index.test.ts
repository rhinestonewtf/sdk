// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Address, Chain } from 'viem'

import { createRhinestoneAccount } from '../src/index'
import * as accountsModule from '../src/accounts'
import * as executionModule from '../src/execution'

vi.mock('../src/accounts', () => ({
  getAddress: vi.fn(),
}))

vi.mock('../src/execution', () => ({
  sendTransaction: vi.fn(),
  waitForExecution: vi.fn(),
  getMaxSpendableAmount: vi.fn(),
}))

describe('Index Tests', () => {
  let mockConfig
  let mockTransaction
  let mockTransactionResult
  let mockChain
  let mockTokenAddress
  let mockGasUnits

  beforeEach(() => {
    vi.resetAllMocks()

    mockConfig = {
      owners: {
        type: 'ecdsa',
        accounts: [{ address: '0xowner' }],
      },
      rhinestoneApiKey: 'test-api-key',
    }

    mockTransaction = {
      chain: { id: 1 },
      calls: [{ to: '0xto', data: '0xdata' }],
      tokenRequests: [],
    }

    mockTransactionResult = {
      type: 'bundle',
      id: 123n,
    }

    mockChain = { id: 1 }

    mockTokenAddress = '0xtoken'

    mockGasUnits = 100000n

    vi.mocked(accountsModule.getAddress).mockReturnValue('0xaccount')
    vi.mocked(executionModule.sendTransaction).mockResolvedValue(mockTransactionResult)
    vi.mocked(executionModule.waitForExecution).mockResolvedValue({ status: 'completed' })
    vi.mocked(executionModule.getMaxSpendableAmount).mockResolvedValue(1000000n)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('createRhinestoneAccount', () => {
    it('should return an object with the expected methods', async () => {
      const account = await createRhinestoneAccount(mockConfig)

      expect(account).toHaveProperty('config')
      expect(account).toHaveProperty('sendTransaction')
      expect(account).toHaveProperty('waitForExecution')
      expect(account).toHaveProperty('getAddress')
      expect(account).toHaveProperty('getMaxSpendableAmount')
      expect(account.config).toBe(mockConfig)
    })

    describe('sendTransaction', () => {
      it('should call the internal sendTransaction function with the correct arguments', async () => {
        const account = await createRhinestoneAccount(mockConfig)

        await account.sendTransaction(mockTransaction)

        expect(executionModule.sendTransaction).toHaveBeenCalledWith(mockConfig, mockTransaction)
      })

      it('should return the result from the internal sendTransaction function', async () => {
        const account = await createRhinestoneAccount(mockConfig)

        const result = await account.sendTransaction(mockTransaction)

        expect(result).toBe(mockTransactionResult)
      })
    })

    describe('waitForExecution', () => {
      it('should call the internal waitForExecution function with the correct arguments', async () => {
        const account = await createRhinestoneAccount(mockConfig)

        await account.waitForExecution(mockTransactionResult)

        expect(executionModule.waitForExecution).toHaveBeenCalledWith(mockConfig, mockTransactionResult)
      })

      it('should return the result from the internal waitForExecution function', async () => {
        const account = await createRhinestoneAccount(mockConfig)

        const result = await account.waitForExecution(mockTransactionResult)

        expect(result).toEqual({ status: 'completed' })
      })
    })

    describe('getAddress', () => {
      it('should call the internal getAddress function with the correct arguments', async () => {
        const account = await createRhinestoneAccount(mockConfig)

        account.getAddress()

        expect(accountsModule.getAddress).toHaveBeenCalledWith(mockConfig)
      })

      it('should return the result from the internal getAddress function', async () => {
        const account = await createRhinestoneAccount(mockConfig)

        const result = account.getAddress()

        expect(result).toBe('0xaccount')
      })
    })

    describe('getMaxSpendableAmount', () => {
      it('should call the internal getMaxSpendableAmount function with the correct arguments', async () => {
        const account = await createRhinestoneAccount(mockConfig)

        await account.getMaxSpendableAmount(mockChain, mockTokenAddress, mockGasUnits)

        expect(executionModule.getMaxSpendableAmount).toHaveBeenCalledWith(
          mockConfig,
          mockChain,
          mockTokenAddress,
          mockGasUnits
        )
      })

      it('should return the result from the internal getMaxSpendableAmount function', async () => {
        const account = await createRhinestoneAccount(mockConfig)

        const result = await account.getMaxSpendableAmount(mockChain, mockTokenAddress, mockGasUnits)

        expect(result).toBe(1000000n)
      })
    })
  })
})
