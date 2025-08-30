import { base } from 'viem/chains'
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
  })
})
