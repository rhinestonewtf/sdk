// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { Address, Chain, zeroAddress } from 'viem'
import {
    arbitrum,
    arbitrumSepolia,
    base,
    baseSepolia,
    mainnet,
    optimism,
    optimismSepolia,
    polygon,
    polygonAmoy,
    sepolia,
} from 'viem/chains'

import {
    getTokenAddress,
    getTokenBalanceSlot,
    getWethAddress,
    getHookAddress,
    getSameChainModuleAddress,
    getTargetModuleAddress,
    getChainById,
} from './registry'

vi.mock('viem', () => ({
    zeroAddress: '0x0000000000000000000000000000000000000000',
}))

vi.mock('viem/chains', () => ({
    mainnet: { id: 1 },
    sepolia: { id: 11155111 },
    base: { id: 8453 },
    baseSepolia: { id: 84532 },
    arbitrum: { id: 42161 },
    arbitrumSepolia: { id: 421614 },
    optimism: { id: 10 },
    optimismSepolia: { id: 11155420 },
    polygon: { id: 137 },
    polygonAmoy: { id: 80002 },
}))

describe('Registry Tests', () => {
    describe('getWethAddress', () => {
        it('should return the correct WETH address for mainnet', () => {
            const result = getWethAddress(mainnet)
            expect(result).toBe('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
        })

        it('should return the correct WETH address for sepolia', () => {
            const result = getWethAddress(sepolia)
            expect(result).toBe('0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14')
        })

        it('should return the correct WETH address for base', () => {
            const result = getWethAddress(base)
            expect(result).toBe('0x4200000000000000000000000000000000000006')
        })

        it('should return the correct WETH address for arbitrum', () => {
            const result = getWethAddress(arbitrum)
            expect(result).toBe('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1')
        })

        it('should throw an error for unsupported chains', () => {
            const unsupportedChain = { id: 999 }
            expect(() => getWethAddress(unsupportedChain)).toThrow('Unsupported chain 999')
        })
    })

    describe('getTokenBalanceSlot', () => {
        it('should return null for ETH (zero address) on mainnet', () => {
            const result = getTokenBalanceSlot(mainnet, zeroAddress)
            expect(result).toBeNull()
        })

        it('should return the correct slot for USDC on mainnet', () => {
            const result = getTokenBalanceSlot(mainnet, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
            expect(result).toBe(9n)
        })

        it('should return the correct slot for WETH on mainnet', () => {
            const result = getTokenBalanceSlot(mainnet, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
            expect(result).toBe(3n)
        })

        it('should throw an error for unsupported token addresses', () => {
            const unsupportedToken = '0x1234567890123456789012345678901234567890'
            expect(() => getTokenBalanceSlot(mainnet, unsupportedToken)).toThrow(
                `Unsupported token address ${unsupportedToken} for chain ${mainnet.id}`
            )
        })
    })

    describe('getHookAddress', () => {
        it('should return the correct hook address', () => {
            const result = getHookAddress()
            expect(result).toBe('0x0000000000f6Ed8Be424d673c63eeFF8b9267420')
        })

        it('should return the same address regardless of chain ID', () => {
            const result1 = getHookAddress(1)
            const result2 = getHookAddress(2)
            expect(result1).toBe(result2)
        })
    })

    describe('getSameChainModuleAddress', () => {
        it('should return the correct same chain module address', () => {
            const result = getSameChainModuleAddress()
            expect(result).toBe('0x000000000043ff16d5776c7F0f65Ec485C17Ca04')
        })

        it('should return the same address regardless of chain ID', () => {
            const result1 = getSameChainModuleAddress(1)
            const result2 = getSameChainModuleAddress(2)
            expect(result1).toBe(result2)
        })
    })

    describe('getTargetModuleAddress', () => {
        it('should return the correct target module address', () => {
            const result = getTargetModuleAddress()
            expect(result).toBe('0x0000000000E5a37279A001301A837a91b5de1D5E')
        })

        it('should return the same address regardless of chain ID', () => {
            const result1 = getTargetModuleAddress(1)
            const result2 = getTargetModuleAddress(2)
            expect(result1).toBe(result2)
        })
    })

    describe('getTokenAddress', () => {
        it('should return zero address for ETH', () => {
            const result = getTokenAddress('ETH', 1)
            expect(result).toBe(zeroAddress)
        })

        it('should return the correct address for WETH', () => {
            const result = getTokenAddress('WETH', 1)
            expect(result).toBe('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
        })

        it('should throw an error for unsupported token symbols', () => {
            expect(() => getTokenAddress('UNKNOWN', 1)).toThrow('Unsupported token symbol UNKNOWN')
        })

        it('should throw an error for unsupported chains', () => {
            expect(() => getTokenAddress('WETH', 999)).toThrow('Unsupported chain 999')
        })
    })

    describe('getChainById', () => {
        it('should return the correct chain for mainnet', () => {
            const result = getChainById(1)
            expect(result).toBe(mainnet)
        })

        it('should return the correct chain for sepolia', () => {
            const result = getChainById(11155111)
            expect(result).toBe(sepolia)
        })

        it('should return undefined for unsupported chain IDs', () => {
            const result = getChainById(999)
            expect(result).toBeUndefined()
        })
    })
})
