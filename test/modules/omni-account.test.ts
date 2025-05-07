// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect } from 'vitest'
import {
    OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS,
    RHINESTONE_MODULE_REGISTRY_ADDRESS,
    RHINESTONE_ATTESTER_ADDRESS,
    HOOK_ADDRESS,
    TARGET_MODULE_ADDRESS,
    SAME_CHAIN_MODULE_ADDRESS,
} from './omni-account'

describe('Omni Account Tests', () => {
    describe('Address Constants', () => {
        it('should export the correct address constants', () => {
            expect(OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS).toBe('0x6D0515e8E499468DCe9583626f0cA15b887f9d03')
            expect(RHINESTONE_MODULE_REGISTRY_ADDRESS).toBe('0x000000000069e2a187aeffb852bf3ccdc95151b2')
            expect(RHINESTONE_ATTESTER_ADDRESS).toBe('0x000000333034E9f539ce08819E12c1b8Cb29084d')
            expect(HOOK_ADDRESS).toBe('0x0000000000f6Ed8Be424d673c63eeFF8b9267420')
            expect(TARGET_MODULE_ADDRESS).toBe('0x0000000000E5a37279A001301A837a91b5de1D5E')
            expect(SAME_CHAIN_MODULE_ADDRESS).toBe('0x000000000043ff16d5776c7F0f65Ec485C17Ca04')
        })

        it('should have valid Ethereum address format for all constants', () => {
            const addresses = [
                OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS,
                RHINESTONE_MODULE_REGISTRY_ADDRESS,
                RHINESTONE_ATTESTER_ADDRESS,
                HOOK_ADDRESS,
                TARGET_MODULE_ADDRESS,
                SAME_CHAIN_MODULE_ADDRESS,
            ]
            
            // Check that all addresses match the Ethereum address format
            addresses.forEach(address => {
                expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
            })
        })
    })
})
