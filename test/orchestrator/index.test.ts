// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect, beforeEach } from 'vitest'

import { Orchestrator } from './client'
import { ORCHESTRATOR_URL, RHINESTONE_SPOKE_POOL_ADDRESS } from './consts'
import { OrchestratorError } from './error'
import {
    getHookAddress,
    getSameChainModuleAddress,
    getTargetModuleAddress,
    getTokenAddress,
    getTokenBalanceSlot,
    getWethAddress,
} from './registry'
import {
    BundleStatusEnum,
    getEmptyUserOp,
    getOrderBundleHash,
} from './utils'

import { getOrchestrator } from './index'

vi.mock('./client', () => ({
    Orchestrator: vi.fn(),
}))

vi.mock('./consts', () => ({
    ORCHESTRATOR_URL: 'https://test-url.com',
    RHINESTONE_SPOKE_POOL_ADDRESS: '0xspokePoolAddress',
}))

vi.mock('./registry', () => ({
    getHookAddress: vi.fn(),
    getSameChainModuleAddress: vi.fn(),
    getTargetModuleAddress: vi.fn(),
    getTokenAddress: vi.fn(),
    getTokenBalanceSlot: vi.fn(),
    getWethAddress: vi.fn(),
}))

vi.mock('./utils', () => ({
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

            expect(Orchestrator).toHaveBeenCalledWith(ORCHESTRATOR_URL, 'test-api-key')
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
        })
    })
})
