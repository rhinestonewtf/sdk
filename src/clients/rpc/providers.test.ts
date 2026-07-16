import { arbitrum, polygon, sepolia } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { getAlchemyRpcUrl, resolveRpcUrl } from './providers'

describe('RPC providers', () => {
  test('resolves Alchemy endpoints from shared configuration', () => {
    expect(getAlchemyRpcUrl(arbitrum.id, '123')).toBe(
      'https://arb-mainnet.g.alchemy.com/v2/123',
    )
    expect(getAlchemyRpcUrl(sepolia.id, '123')).toBe(
      'https://eth-sepolia.g.alchemy.com/v2/123',
    )
    expect(getAlchemyRpcUrl(polygon.id, '123')).toBe(
      'https://polygon-mainnet.g.alchemy.com/v2/123',
    )
  })

  test('preserves custom fallback-to-public behavior', () => {
    expect(
      resolveRpcUrl(arbitrum.id, {
        kind: 'custom',
        urls: { [arbitrum.id]: 'http://localhost:8545' },
      }),
    ).toBe('http://localhost:8545')
    expect(
      resolveRpcUrl(sepolia.id, {
        kind: 'custom',
        urls: { [arbitrum.id]: 'http://localhost:8545' },
      }),
    ).toBeUndefined()
  })
})
