// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect } from 'vitest'
import {
    ORCHESTRATOR_URL,
    RHINESTONE_SPOKE_POOL_ADDRESS,
} from '../../src/orchestrator/consts'

describe('Orchestrator Constants Tests', () => {
    describe('ORCHESTRATOR_URL', () => {
        it('should be a valid URL', () => {
            expect(ORCHESTRATOR_URL).toMatch(/^https?:\/\//)
        })
    })

    describe('RHINESTONE_SPOKE_POOL_ADDRESS', () => {
        it('should be a valid Ethereum address', () => {
            expect(RHINESTONE_SPOKE_POOL_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/)
        })
    })
})
