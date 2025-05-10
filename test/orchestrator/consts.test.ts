// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect } from 'vitest'
import {
    PROD_ORCHESTRATOR_URL,
    DEV_ORCHESTRATOR_URL,
    RHINESTONE_SPOKE_POOL_ADDRESS,
} from '../../src/orchestrator/consts'

describe('Orchestrator Constants Tests', () => {
    describe('PROD_ORCHESTRATOR_URL', () => {
        it('should be a valid URL', () => {
            expect(PROD_ORCHESTRATOR_URL).toMatch(/^https?:\/\//)
        })
    })

    describe('DEV_ORCHESTRATOR_URL', () => {
        it('should be a valid URL', () => {
            expect(DEV_ORCHESTRATOR_URL).toMatch(/^https?:\/\//)
        })
    })

    describe('RHINESTONE_SPOKE_POOL_ADDRESS', () => {
        it('should be a valid Ethereum address', () => {
            expect(RHINESTONE_SPOKE_POOL_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/)
        })
    })
})
