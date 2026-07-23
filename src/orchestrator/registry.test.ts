import type { Address } from 'viem'
import { arbitrum, baseSepolia, sepolia } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { getChainById, isTestnet, resolveTokenAddress } from './registry'

// A chain id absent from both viem and the Rhinestone-supported set. (v2
// resolves `Chain` objects via viem, so a real-but-unsupported chain like Blast
// would now resolve — this must be a genuinely unknown id to still exercise throws.)
const UNSUPPORTED_CHAIN_ID = 424242

const ARBITRUM_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address

describe('Registry', () => {
  describe('getChainById', () => {
    test('returns correct chain for supported ID', () => {
      const chain = getChainById(arbitrum.id)
      expect(chain.id).toBe(arbitrum.id)
      expect(chain.name).toBe(arbitrum.name)
    })

    test('throws error for unknown chain', () => {
      expect(() => getChainById(UNSUPPORTED_CHAIN_ID)).toThrow(
        `Unsupported chain ${UNSUPPORTED_CHAIN_ID}`,
      )
    })
  })

  describe('isTestnet', () => {
    test('returns false for arbitrum', () => {
      expect(isTestnet(arbitrum.id)).toBe(false)
    })

    test('returns true for testnet', () => {
      expect(isTestnet(sepolia.id)).toBe(true)
    })

    test('throws error for unknown chain', () => {
      expect(() => isTestnet(UNSUPPORTED_CHAIN_ID)).toThrow(
        `Unsupported chain ${UNSUPPORTED_CHAIN_ID}`,
      )
    })
  })

  describe('resolveTokenAddress', () => {
    test('returns the address as-is when given a valid address', () => {
      expect(resolveTokenAddress(ARBITRUM_USDC, arbitrum.id)).toBe(
        ARBITRUM_USDC,
      )
    })

    test('throws for a non-address on an EVM chain (symbols no longer accepted)', () => {
      expect(() =>
        resolveTokenAddress('USDC' as Address, baseSepolia.id),
      ).toThrow(`Expected a token address on EVM chain ${baseSepolia.id}`)
    })
  })
})
