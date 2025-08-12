import { mainnet, polygon, sepolia } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { getAlchemyUrl } from './providers'

describe('Providers', () => {
  describe('Alchemy', () => {
    test('Network', () => {
      const mockApiKey = '123'

      expect(getAlchemyUrl(mainnet.id, mockApiKey)).toBe(
        'https://eth-mainnet.g.alchemy.com/v2/123',
      )
      expect(getAlchemyUrl(sepolia.id, mockApiKey)).toBe(
        'https://eth-sepolia.g.alchemy.com/v2/123',
      )
      expect(getAlchemyUrl(polygon.id, mockApiKey)).toBe(
        'https://polygon-mainnet.g.alchemy.com/v2/123',
      )
    })
  })
})
