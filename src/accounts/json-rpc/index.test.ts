import { base, mainnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'

import { createTransport } from './index'

describe('JSON-RPC', () => {
  describe('createTransport', () => {
    test('Alchemy', () => {
      const transport = createTransport(base, {
        type: 'alchemy',
        apiKey: '123',
      })
      expect(transport).toBeDefined()
    })

    test('Custom', () => {
      const transport = createTransport(mainnet, {
        type: 'custom',
        urls: {
          [mainnet.id]: 'https://my-rpc.example.com',
        },
      })
      expect(transport).toBeDefined()
    })

    test('Custom falls back to default when URL not configured for chain', () => {
      const transport = createTransport(mainnet, {
        type: 'custom',
        urls: {
          [base.id]: 'https://my-rpc.example.com',
        },
      })
      // Should not throw and return a valid transport using default provider
      expect(transport).toBeDefined()
    })
  })
})
