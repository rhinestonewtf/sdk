// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect, beforeEach } from 'vitest'

import { Orchestrator } from '../../src/orchestrator/client'
import { PROD_ORCHESTRATOR_URL, RHINESTONE_SPOKE_POOL_ADDRESS } from '../../src/orchestrator/consts'
import { OrchestratorError } from '../../src/orchestrator/error'
import {
    getHookAddress,
    getSameChainModuleAddress,
    getTargetModuleAddress,
    getTokenAddress,
    getTokenBalanceSlot,
    getTokenRootBalanceSlot,
    getTokenSymbol,
    getRhinestoneSpokePoolAddress,
    getWethAddress,
} from '../../src/orchestrator/registry'
import {
    BundleStatusEnum,
    getEmptyUserOp,
    getOrderBundleHash,
} from '../../src/orchestrator/utils'

import { getOrchestrator } from '../../src/orchestrator'

vi.mock('../../src/orchestrator/client', () => ({
    Orchestrator: vi.fn(),
}))

vi.mock('../../src/orchestrator/consts', () => ({
    PROD_ORCHESTRATOR_URL: 'https://test-url.com',
    RHINESTONE_SPOKE_POOL_ADDRESS: '0xspokePoolAddress',
}))

vi.mock('../../src/orchestrator/registry', () => ({
    getHookAddress: vi.fn(),
    getSameChainModuleAddress: vi.fn(),
    getTargetModuleAddress: vi.fn(),
    getTokenAddress: vi.fn(),
    getTokenBalanceSlot: vi.fn(),
    getTokenRootBalanceSlot: vi.fn(),
    getTokenSymbol: vi.fn(),
    getRhinestoneSpokePoolAddress: vi.fn(),
    getWethAddress: vi.fn(),
}))

vi.mock('../../src/orchestrator/utils', () => ({
    BundleStatusEnum: {
        PENDING: 'pending',
        EXPIRED: 'expired',
        PARTIALLY_COMPLETED: 'partially_completed',
        COMPLETED: 'completed',
        FILLED: 'filled',
        FAILED: 'failed',
        UNKNOWN: 'unknown',
    },
    getEmptyUserOp: vi.fn(),
    getOrderBundleHash: vi.fn(),
}))

describe('Orchestrator Index Tests', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    describe('getOrchestrator', () => {
        it('should create a new Orchestrator instance with the provided API key', () => {
            const mockOrchestrator = {}
            vi.mocked(Orchestrator).mockReturnValue(mockOrchestrator)

            const result = getOrchestrator('test-api-key')

            expect(Orchestrator).toHaveBeenCalledWith(PROD_ORCHESTRATOR_URL, 'test-api-key')
            expect(result).toBe(mockOrchestrator)
        })

        it('should use the provided URL if specified', () => {
            const mockOrchestrator = {}
            vi.mocked(Orchestrator).mockReturnValue(mockOrchestrator)

            const result = getOrchestrator('test-api-key', 'https://custom-url.com')

            expect(Orchestrator).toHaveBeenCalledWith('https://custom-url.com', 'test-api-key')
            expect(result).toBe(mockOrchestrator)
        })
    })

    describe('Exports', () => {
        it('should verify that the exported functions are defined', () => {
            expect(getOrchestrator).toBeDefined()
            expect(BundleStatusEnum).toBeDefined()
            expect(getEmptyUserOp).toBeDefined()
            expect(getOrderBundleHash).toBeDefined()
            expect(getTokenRootBalanceSlot).toBeDefined()
            expect(getTokenSymbol).toBeDefined()
            expect(getRhinestoneSpokePoolAddress).toBeDefined()
        })
    })
})
