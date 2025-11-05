import { arbitrum, polygon, sepolia } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { getAlchemyUrl, getCustomUrl } from './providers'

describe('Providers', () => {
  describe('Alchemy', () => {
    test('Network', () => {
      const mockApiKey = '123'

      expect(getAlchemyUrl(arbitrum.id, mockApiKey)).toBe(
        'https://arb-mainnet.g.alchemy.com/v2/123',
      )
      expect(getAlchemyUrl(sepolia.id, mockApiKey)).toBe(
        'https://eth-sepolia.g.alchemy.com/v2/123',
      )
      expect(getAlchemyUrl(polygon.id, mockApiKey)).toBe(
        'https://polygon-mainnet.g.alchemy.com/v2/123',
      )
    })
  })

  describe('Custom', () => {
    test('Returns URL for configured chain', () => {
      const urls = {
        [arbitrum.id]: 'https://my-rpc.example.com/mainnet',
        [sepolia.id]: 'https://my-rpc.example.com/sepolia',
      }

      expect(getCustomUrl(arbitrum.id, urls)).toBe(
        'https://my-rpc.example.com/mainnet',
      )
      expect(getCustomUrl(sepolia.id, urls)).toBe(
        'https://my-rpc.example.com/sepolia',
      )
    })

    test('Throws error when chain not configured', () => {
      const urls = {
        [arbitrum.id]: 'https://my-rpc.example.com/mainnet',
      }

      expect(() => getCustomUrl(sepolia.id, urls)).toThrow(
        'No custom provider URL configured for chain 11155111',
      )
    })

    test('Accepts HTTP URLs', () => {
      const urls = {
        [arbitrum.id]: 'http://localhost:8545',
      }

      expect(getCustomUrl(arbitrum.id, urls)).toBe('http://localhost:8545')
    })

    test('Accepts HTTPS URLs', () => {
      const urls = {
        [arbitrum.id]: 'https://my-rpc.example.com',
      }

      expect(getCustomUrl(arbitrum.id, urls)).toBe('https://my-rpc.example.com')
    })
  })
})
