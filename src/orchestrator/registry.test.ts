import { type Chain, zeroAddress } from 'viem'
import { arbitrum, base, baseSepolia, sepolia } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import {
  getChainById,
  getDefaultAccountAccessList,
  getSupportedChainIds,
  getSupportedTokens,
  getTokenAddress,
  getTokenSymbol,
  getWethAddress,
  isTestnet,
  isTokenAddressSupported,
  resolveTokenAddress,
} from './registry'

const DEPRECATED_CHAIN_ID = 5 // Goerli
const UNSUPPORTED_CHAIN_ID = 56 // BNB Chain

const TOKEN_SYMBOLS = {
  ETH: 'ETH',
  USDC: 'USDC',
  USDT: 'USDT',
  WETH: 'WETH',
} as const

const TOKEN_ADDRESSES = {
  ARBTRUM_USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  BASE_WETH: '0x4200000000000000000000000000000000000006',
} as const

const UNSUPPORTED_TOKEN_ADDRESS = '0x1234567890123456789012345678901234567890'

describe('Registry', () => {
  describe('getSupportedChainIds', () => {
    test('returns supported chain IDs', () => {
      const chainIds = getSupportedChainIds()
      expect(chainIds).toContain(arbitrum.id)
      expect(chainIds).toContain(base.id)
      expect(chainIds).toContain(sepolia.id)
    })

    test('does not include unsupported chains', () => {
      const chainIds = getSupportedChainIds()
      expect(chainIds).not.toContain(DEPRECATED_CHAIN_ID)
      expect(chainIds).not.toContain(UNSUPPORTED_CHAIN_ID)
    })
  })

  describe('getTokenSymbol', () => {
    test('returns correct symbol for supported token', () => {
      const symbol = getTokenSymbol(TOKEN_ADDRESSES.ARBTRUM_USDC, arbitrum.id)
      expect(symbol).toBe(TOKEN_SYMBOLS.USDC)
    })

    test('throws error for unsupported chain', () => {
      expect(() =>
        getTokenSymbol(TOKEN_ADDRESSES.ARBTRUM_USDC, UNSUPPORTED_CHAIN_ID),
      ).toThrow(`Unsupported chain ${UNSUPPORTED_CHAIN_ID}`)
    })
  })

  describe('getTokenAddress', () => {
    test('returns zero address for ETH', () => {
      const address = getTokenAddress(TOKEN_SYMBOLS.ETH, arbitrum.id)
      expect(address).toBe(zeroAddress)
    })

    test('returns correct address for token symbol', () => {
      const address = getTokenAddress(TOKEN_SYMBOLS.USDC, arbitrum.id)
      expect(address).toBe(TOKEN_ADDRESSES.ARBTRUM_USDC)
    })

    test('throws error for unsupported chain', () => {
      expect(() =>
        getTokenAddress(TOKEN_SYMBOLS.USDC, UNSUPPORTED_CHAIN_ID),
      ).toThrow(`Unsupported chain ${UNSUPPORTED_CHAIN_ID}`)
    })
  })

  describe('getWethAddress', () => {
    test('returns correct WETH address', () => {
      const address = getWethAddress(base)
      expect(address).toBe(TOKEN_ADDRESSES.BASE_WETH)
    })

    test('throws error for unsupported chain', () => {
      const unsupportedChain = {
        id: UNSUPPORTED_CHAIN_ID,
        name: 'Unsupported',
      } as Chain
      expect(() => getWethAddress(unsupportedChain)).toThrow(
        `Unsupported chain ${UNSUPPORTED_CHAIN_ID}`,
      )
    })
  })

  describe('getChainById', () => {
    test('returns correct chain for supported ID', () => {
      const chain = getChainById(arbitrum.id)
      expect(chain.id).toBe(arbitrum.id)
      expect(chain.name).toBe(arbitrum.name)
    })

    test('throws error for unsupported chain', () => {
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

    test('throws error for unsupported chain', () => {
      expect(() => isTestnet(UNSUPPORTED_CHAIN_ID)).toThrow(
        `Unsupported chain ${UNSUPPORTED_CHAIN_ID}`,
      )
    })
  })

  describe('isTokenAddressSupported', () => {
    test('returns true for supported token', () => {
      const isSupported = isTokenAddressSupported(
        TOKEN_ADDRESSES.ARBTRUM_USDC,
        arbitrum.id,
      )
      expect(isSupported).toBe(true)
    })

    test('returns false for unsupported token or chain', () => {
      expect(
        isTokenAddressSupported(UNSUPPORTED_TOKEN_ADDRESS, arbitrum.id),
      ).toBe(false)
      expect(
        isTokenAddressSupported(
          TOKEN_ADDRESSES.ARBTRUM_USDC,
          UNSUPPORTED_CHAIN_ID,
        ),
      ).toBe(false)
    })
  })

  describe('getSupportedTokens', () => {
    test('returns tokens for supported chain', () => {
      const tokens = getSupportedTokens(arbitrum.id)
      expect(tokens.length).toBeGreaterThan(0)
      expect(tokens.find((t) => t.symbol === TOKEN_SYMBOLS.USDC)).toBeDefined()
    })

    test('throws error for unsupported chain', () => {
      expect(() => getSupportedTokens(UNSUPPORTED_CHAIN_ID)).toThrow(
        `Unsupported chain ${UNSUPPORTED_CHAIN_ID}`,
      )
    })
  })

  describe('getDefaultAccountAccessList', () => {
    test('filters chains by testnet status', () => {
      const arbitrumList = getDefaultAccountAccessList(false)
      const testnetList = getDefaultAccountAccessList(true)

      expect(arbitrumList.chainIds).toContain(arbitrum.id)
      expect(arbitrumList.chainIds).not.toContain(sepolia.id)

      expect(testnetList.chainIds).toContain(sepolia.id)
      expect(testnetList.chainIds).not.toContain(arbitrum.id)
    })
  })

  describe('resolveTokenAddress', () => {
    test('returns address as-is when given valid address', () => {
      const address = TOKEN_ADDRESSES.ARBTRUM_USDC
      const result = resolveTokenAddress(address, arbitrum.id)
      expect(result).toBe(address)
    })

    test('resolves token symbol to address', () => {
      const result = resolveTokenAddress(TOKEN_SYMBOLS.USDC, arbitrum.id)
      expect(result).toBe(TOKEN_ADDRESSES.ARBTRUM_USDC)
    })

    test('throw error for unsupported token', () => {
      expect(() =>
        resolveTokenAddress(TOKEN_SYMBOLS.USDT, baseSepolia.id),
      ).toThrow(
        `Unsupported token ${TOKEN_SYMBOLS.USDT} for chain ${baseSepolia.id}`,
      )
    })

    test('throws error for unsupported chain', () => {
      expect(() =>
        resolveTokenAddress(TOKEN_SYMBOLS.USDC, UNSUPPORTED_CHAIN_ID),
      ).toThrow(`Unsupported chain ${UNSUPPORTED_CHAIN_ID}`)
    })
  })
})
