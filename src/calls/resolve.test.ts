import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import type { EvmChainReference } from '../chains/types'
import { normalizeCall, normalizeCalls } from './normalize'
import { resolveCalls } from './resolve'
import type { Call } from './types'

const chain: EvmChainReference = { kind: 'evm', id: 1, caip2: 'eip155:1' }
const account = '0x0000000000000000000000000000000000000001'
const target = '0x0000000000000000000000000000000000000002'

describe('calls', () => {
  test('normalizes optional fields and rejects invalid values', () => {
    expect(normalizeCall({ target })).toEqual({ target, value: 0n, data: '0x' })
    expect(() => normalizeCall({ target: 'invalid' })).toThrow()
    expect(() => normalizeCall({ target, value: -1n })).toThrow()
  })

  test('flattens lazy results in declared order with opaque config', async () => {
    const config = { marker: Symbol('config') }
    const direct: Call = { target, value: 1n, data: '0x01' }
    const seen: unknown[] = []
    const result = await resolveCalls(
      [
        direct,
        {
          resolve: async (context) => {
            seen.push(context.config)
            return [
              { target: account, value: 2n, data: '0x02' },
              { target, value: 3n, data: '0x03' },
            ]
          },
        },
      ],
      { account, chain, config },
    )
    expect(result.map((call) => call.value)).toEqual([1n, 2n, 3n])
    expect(seen).toEqual([config])
  })

  test('normalizes a single lazy result to one call', async () => {
    const call = { target, value: 4n, data: '0x04' } as const
    await expect(
      resolveCalls([{ resolve: async () => call }], {
        account,
        chain,
        config: undefined,
      }),
    ).resolves.toEqual([call])
  })

  test('normalization is idempotent', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n }), (value) => {
        const once = normalizeCalls([{ target, value, data: '0x' }])
        const twice = normalizeCalls(once)
        expect(twice).toEqual(once)
      }),
    )
  })
})
