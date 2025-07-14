import { zeroAddress } from 'viem'
import { base, baseSepolia, mainnet, sepolia } from 'viem/chains'
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
  ETHEREUM_USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  BASE_WETH: '0x4200000000000000000000000000000000000006',
} as const

const UNSUPPORTED_TOKEN_ADDRESS = '0x1234567890123456789012345678901234567890'

describe('Registry', () => {
  describe('getSupportedChainIds', () => {
    test('returns supported chain IDs', () => {
      const chainIds = getSupportedChainIds()
      expect(chainIds).toContain(mainnet.id)
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
      const symbol = getTokenSymbol(TOKEN_ADDRESSES.ETHEREUM_USDC, mainnet.id)
      expect(symbol).toBe(TOKEN_SYMBOLS.USDC)
    })

    test('throws error for unsupported chain', () => {
      expect(() =>
        getTokenSymbol(TOKEN_ADDRESSES.ETHEREUM_USDC, UNSUPPORTED_CHAIN_ID),
      ).toThrow(`Unsupported chain ${UNSUPPORTED_CHAIN_ID}`)
    })
  })

  describe('getTokenAddress', () => {
    test('returns zero address for ETH', () => {
      const address = getTokenAddress(TOKEN_SYMBOLS.ETH, mainnet.id)
      expect(address).toBe(zeroAddress)
    })

    test('returns correct address for token symbol', () => {
      const address = getTokenAddress(TOKEN_SYMBOLS.USDC, mainnet.id)
      expect(address).toBe(TOKEN_ADDRESSES.ETHEREUM_USDC)
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
      } as any
      expect(() => getWethAddress(unsupportedChain)).toThrow(
        `Unsupported chain ${UNSUPPORTED_CHAIN_ID}`,
      )
    })
  })

  describe('getChainById', () => {
    test('returns correct chain for supported ID', () => {
      const chain = getChainById(mainnet.id)
      expect(chain?.id).toBe(mainnet.id)
      expect(chain?.name).toBe(mainnet.name)
    })

    test('returns undefined for unsupported chain', () => {
      expect(getChainById(UNSUPPORTED_CHAIN_ID)).toBeUndefined()
    })
  })

  describe('isTestnet', () => {
    test('returns false for mainnet', () => {
      expect(isTestnet(mainnet.id)).toBe(false)
    })

    test('returns true for testnet', () => {
      expect(isTestnet(sepolia.id)).toBe(true)
    })

    test('throws error for unsupported chain', () => {
      expect(() => isTestnet(UNSUPPORTED_CHAIN_ID)).toThrow(
        `Chain not supported: ${UNSUPPORTED_CHAIN_ID}`,
      )
    })
  })

  describe('isTokenAddressSupported', () => {
    test('returns true for supported token', () => {
      const isSupported = isTokenAddressSupported(
        TOKEN_ADDRESSES.ETHEREUM_USDC,
        mainnet.id,
      )
      expect(isSupported).toBe(true)
    })

    test('returns false for unsupported token or chain', () => {
      expect(
        isTokenAddressSupported(UNSUPPORTED_TOKEN_ADDRESS, mainnet.id),
      ).toBe(false)
      expect(
        isTokenAddressSupported(
          TOKEN_ADDRESSES.ETHEREUM_USDC,
          UNSUPPORTED_CHAIN_ID,
        ),
      ).toBe(false)
    })
  })

  describe('getSupportedTokens', () => {
    test('returns tokens for supported chain', () => {
      const tokens = getSupportedTokens(mainnet.id)
      expect(tokens.length).toBeGreaterThan(0)
      expect(tokens.find((t) => t.symbol === TOKEN_SYMBOLS.USDC)).toBeDefined()
    })

    test('throws error for unsupported chain', () => {
      expect(() => getSupportedTokens(UNSUPPORTED_CHAIN_ID)).toThrow(
        `Chain not supported: ${UNSUPPORTED_CHAIN_ID}`,
      )
    })
  })

  describe('getDefaultAccountAccessList', () => {
    test('filters chains by testnet status', () => {
      const mainnetList = getDefaultAccountAccessList(false)
      const testnetList = getDefaultAccountAccessList(true)

      expect(mainnetList.chainIds).toContain(mainnet.id)
      expect(mainnetList.chainIds).not.toContain(sepolia.id)

      expect(testnetList.chainIds).toContain(sepolia.id)
      expect(testnetList.chainIds).not.toContain(mainnet.id)
    })
  })

  describe('resolveTokenAddress', () => {
    test('returns address as-is when given valid address', () => {
      const address = TOKEN_ADDRESSES.ETHEREUM_USDC
      const result = resolveTokenAddress(address, mainnet.id)
      expect(result).toBe(address)
    })

    test('resolves token symbol to address', () => {
      const result = resolveTokenAddress(TOKEN_SYMBOLS.USDC, mainnet.id)
      expect(result).toBe(TOKEN_ADDRESSES.ETHEREUM_USDC)
    })

    test('throw error for unsupported token', () => {
      expect(() =>
        resolveTokenAddress(TOKEN_SYMBOLS.USDT, baseSepolia.id),
      ).toThrow(`Unsupported token symbol ${TOKEN_SYMBOLS.USDT}`)
    })

    test('throws error for unsupported chain', () => {
      expect(() =>
        resolveTokenAddress(TOKEN_SYMBOLS.USDC, UNSUPPORTED_CHAIN_ID),
      ).toThrow(`Unsupported chain ${UNSUPPORTED_CHAIN_ID}`)
    })
  })
})
