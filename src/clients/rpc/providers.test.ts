import { arbitrum, sepolia } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { resolveRpcUrl } from './providers'

describe('RPC providers', () => {
  test('resolves custom URLs and falls back to public', () => {
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
    expect(resolveRpcUrl(arbitrum.id, { kind: 'public' })).toBeUndefined()
  })
})
