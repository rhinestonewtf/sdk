import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import {
  chainIdFromReference,
  formatCaip2,
  isCaip2,
  isEvmCaip2,
  isNonEvmChainId,
  parseCaip2,
  toEvmChainReference,
} from './caip2'

describe('CAIP-2', () => {
  test.each([
    [1, 'eip155:1'],
    [8453, 'eip155:8453'],
    [792703809, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    [728126428, 'tron:mainnet'],
    [1337, 'hypercore:mainnet'],
  ] as const)('formats and parses %i', (id, caip2) => {
    expect(formatCaip2(id)).toBe(caip2)
    expect(chainIdFromReference(parseCaip2(caip2))).toBe(id)
    expect(isCaip2(caip2)).toBe(true)
  })

  test('preserves the legacy HyperCore alias', () => {
    expect(chainIdFromReference(parseCaip2('eip155:1337'))).toBe(1337)
    expect(isNonEvmChainId(1337)).toBe(false)
  })

  test('rejects malformed and unknown values', () => {
    expect(() => parseCaip2('eip155:-1')).toThrow()
    expect(() => parseCaip2('eip155:01')).toThrow()
    expect(() => parseCaip2('cosmos:cosmoshub-4')).toThrow()
    expect(isEvmCaip2('hypercore:mainnet')).toBe(false)
    expect(isCaip2('not-a-chain')).toBe(false)
    expect(() => formatCaip2(-1)).toThrow('Invalid chain id')
    expect(() => formatCaip2(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      'Invalid chain id',
    )
    expect(() => toEvmChainReference(792703809)).toThrow('not EVM-compatible')
  })

  test('materializes EVM references and rejects invalid non-EVM references', () => {
    expect(toEvmChainReference(1)).toEqual({
      kind: 'evm',
      id: 1,
      caip2: 'eip155:1',
    })
    expect(toEvmChainReference(1337).caip2).toBe('hypercore:mainnet')
    expect(() =>
      chainIdFromReference({
        kind: 'non-evm',
        namespace: 'unknown',
        reference: 'chain',
        caip2: 'unknown:chain',
      }),
    ).toThrow('Invalid CAIP-2')
  })

  test('round-trips arbitrary non-negative EVM chain ids', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (chainId) => {
        const caip2 = `eip155:${chainId}`
        expect(chainIdFromReference(parseCaip2(caip2))).toBe(chainId)
      }),
    )
  })
})
