// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Address, Chain } from 'viem'

import { createRhinestoneAccount } from './index'
import * as accountsModule from './accounts'
import * as executionModule from './execution'

// Mock dependencies
vi.mock('./accounts', () => ({
  getAddress: vi.fn(),
}))

vi.mock('./execution', () => ({
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
    // Reset mocks
    vi.resetAllMocks()

    // Mock config
    mockConfig = {
      owners: {
        type: 'ecdsa',
        accounts: [{ address: '0xowner' }],
      },
      rhinestoneApiKey: 'test-api-key',
    }

    // Mock transaction
    mockTransaction = {
      chain: { id: 1 },
      calls: [{ to: '0xto', data: '0xdata' }],
      tokenRequests: [],
    }

    // Mock transaction result
    mockTransactionResult = {
      type: 'bundle',
      id: 123n,
    }

    // Mock chain
    mockChain = { id: 1 }

    // Mock token address
    mockTokenAddress = '0xtoken'

    // Mock gas units
    mockGasUnits = 100000n

    // Mock function implementations
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
      // Call the function
      const account = await createRhinestoneAccount(mockConfig)

      // Verify the result
      expect(account).toHaveProperty('config')
      expect(account).toHaveProperty('sendTransaction')
      expect(account).toHaveProperty('waitForExecution')
      expect(account).toHaveProperty('getAddress')
      expect(account).toHaveProperty('getMaxSpendableAmount')
      expect(account.config).toBe(mockConfig)
    })

    describe('sendTransaction', () => {
      it('should call the internal sendTransaction function with the correct arguments', async () => {
        // Create account
        const account = await createRhinestoneAccount(mockConfig)

        // Call the method
        await account.sendTransaction(mockTransaction)

        // Verify the result
        expect(executionModule.sendTransaction).toHaveBeenCalledWith(mockConfig, mockTransaction)
      })

      it('should return the result from the internal sendTransaction function', async () => {
        // Create account
        const account = await createRhinestoneAccount(mockConfig)

        // Call the method
        const result = await account.sendTransaction(mockTransaction)

        // Verify the result
        expect(result).toBe(mockTransactionResult)
      })
    })

    describe('waitForExecution', () => {
      it('should call the internal waitForExecution function with the correct arguments', async () => {
        // Create account
        const account = await createRhinestoneAccount(mockConfig)

        // Call the method
        await account.waitForExecution(mockTransactionResult)

        // Verify the result
        expect(executionModule.waitForExecution).toHaveBeenCalledWith(mockConfig, mockTransactionResult)
      })

      it('should return the result from the internal waitForExecution function', async () => {
        // Create account
        const account = await createRhinestoneAccount(mockConfig)

        // Call the method
        const result = await account.waitForExecution(mockTransactionResult)

        // Verify the result
        expect(result).toEqual({ status: 'completed' })
      })
    })

    describe('getAddress', () => {
      it('should call the internal getAddress function with the correct arguments', async () => {
        // Create account
        const account = await createRhinestoneAccount(mockConfig)

        // Call the method
        account.getAddress()

        // Verify the result
        expect(accountsModule.getAddress).toHaveBeenCalledWith(mockConfig)
      })

      it('should return the result from the internal getAddress function', async () => {
        // Create account
        const account = await createRhinestoneAccount(mockConfig)

        // Call the method
        const result = account.getAddress()

        // Verify the result
        expect(result).toBe('0xaccount')
      })
    })

    describe('getMaxSpendableAmount', () => {
      it('should call the internal getMaxSpendableAmount function with the correct arguments', async () => {
        // Create account
        const account = await createRhinestoneAccount(mockConfig)

        // Call the method
        await account.getMaxSpendableAmount(mockChain, mockTokenAddress, mockGasUnits)

        // Verify the result
        expect(executionModule.getMaxSpendableAmount).toHaveBeenCalledWith(
          mockConfig,
          mockChain,
          mockTokenAddress,
          mockGasUnits
        )
      })

      it('should return the result from the internal getMaxSpendableAmount function', async () => {
        // Create account
        const account = await createRhinestoneAccount(mockConfig)

        // Call the method
        const result = await account.getMaxSpendableAmount(mockChain, mockTokenAddress, mockGasUnits)

        // Verify the result
        expect(result).toBe(1000000n)
      })
    })
  })
})
