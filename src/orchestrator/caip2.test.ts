import { describe, expect, test } from 'vitest'
import {
  fromCaip2,
  isCaip2,
  isEvmCaip2,
  isNonEvmChainId,
  toCaip2,
} from './caip2'

describe('toCaip2', () => {
  test('encodes EVM chain ids with eip155 namespace', () => {
    expect(toCaip2(1)).toBe('eip155:1')
    expect(toCaip2(8453)).toBe('eip155:8453')
    expect(toCaip2(42161)).toBe('eip155:42161')
  })

  test('encodes Solana synthetic id to its CAIP-2 string', () => {
    expect(toCaip2(792703809)).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
  })

  test('encodes Tron synthetic id to its CAIP-2 string', () => {
    expect(toCaip2(728126428)).toBe('tron:0x2b6653dc')
  })

  test('rejects negative or non-integer ids', () => {
    expect(() => toCaip2(-1)).toThrow()
    expect(() => toCaip2(1.5)).toThrow()
  })
})

describe('fromCaip2', () => {
  test('decodes eip155 namespace to numeric chain id', () => {
    expect(fromCaip2('eip155:1')).toBe(1)
    expect(fromCaip2('eip155:42161')).toBe(42161)
  })

  test('decodes solana CAIP-2 to synthetic id', () => {
    expect(fromCaip2('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')).toBe(792703809)
  })

  test('decodes tron CAIP-2 to synthetic id', () => {
    expect(fromCaip2('tron:0x2b6653dc')).toBe(728126428)
  })

  test('rejects unknown namespaces', () => {
    expect(() => fromCaip2('cosmos:cosmoshub-4')).toThrow()
  })

  test('rejects unknown non-EVM references', () => {
    expect(() => fromCaip2('solana:unknown-ref')).toThrow()
  })
})

describe('round-trip', () => {
  test.each([1, 8453, 42161, 792703809, 728126428])(
    'id %d round-trips through CAIP-2',
    (id) => {
      expect(fromCaip2(toCaip2(id))).toBe(id)
    },
  )
})

describe('isCaip2 / isEvmCaip2', () => {
  test('isCaip2 accepts all supported namespaces', () => {
    expect(isCaip2('eip155:1')).toBe(true)
    expect(isCaip2('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')).toBe(true)
    expect(isCaip2('tron:0x2b6653dc')).toBe(true)
    expect(isCaip2('cosmos:cosmoshub-4')).toBe(false)
    expect(isCaip2('not-a-caip2')).toBe(false)
  })

  test('isEvmCaip2 only matches eip155', () => {
    expect(isEvmCaip2('eip155:1')).toBe(true)
    expect(isEvmCaip2('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')).toBe(false)
    expect(isEvmCaip2('tron:0x2b6653dc')).toBe(false)
  })
})

describe('isNonEvmChainId', () => {
  test('matches known synthetic ids', () => {
    expect(isNonEvmChainId(792703809)).toBe(true)
    expect(isNonEvmChainId(728126428)).toBe(true)
  })

  test('rejects EVM chain ids', () => {
    expect(isNonEvmChainId(1)).toBe(false)
    expect(isNonEvmChainId(42161)).toBe(false)
  })
})
