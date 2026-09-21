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
import {
  hyperCorePerp,
  hyperCoreSpot,
  solanaMainnet,
  stellarMainnet,
  tronMainnet,
} from './non-evm'

describe('CAIP-2', () => {
  test.each([
    [1, 'eip155:1'],
    [8453, 'eip155:8453'],
    [792703809, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    [728126428, 'tron:mainnet'],
    [1500148, 'stellar:pubnet'],
    [1337, 'hypercore:mainnet'],
    [1337001, 'hypercore:spot'],
    [1337002, 'hypercore:perp'],
  ] as const)('formats and parses %i', (id, caip2) => {
    expect(formatCaip2(id)).toBe(caip2)
    expect(chainIdFromReference(parseCaip2(caip2))).toBe(id)
    expect(isCaip2(caip2)).toBe(true)
  })

  test('preserves the legacy HyperCore alias', () => {
    expect(chainIdFromReference(parseCaip2('eip155:1337'))).toBe(1337)
    expect(isNonEvmChainId(1337)).toBe(false)
  })

  // The venue ids must be in this table, not just in the exported descriptors.
  // Without an entry, `formatCaip2(1337001)` emits `eip155:1337001` and
  // `parseCaip2('hypercore:spot')` throws — so `hyperCoreSpot` would fail to
  // address the destination it names, which is the whole point of the split.
  // Types cannot catch this: the table is data (RHI-5510).
  test('routes every HyperCore venue through the wire table', () => {
    for (const [id, caip2] of [
      [1337001, 'hypercore:spot'],
      [1337002, 'hypercore:perp'],
    ] as const) {
      expect(formatCaip2(id)).toBe(caip2)
      expect(chainIdFromReference(parseCaip2(caip2))).toBe(id)
      // EVM-addressed, so recipients stay hex and no non-EVM branch is taken.
      expect(isNonEvmChainId(id)).toBe(false)
      expect(parseCaip2(caip2).kind).toBe('evm')
      // `hypercore:*` is EVM-addressed but not `eip155:`, the one combination
      // `toEvmChainReference` has to let through rather than reject.
      expect(toEvmChainReference(id).caip2).toBe(caip2)
    }
  })

  // Stellar recipients are `G…` accounts while its token addresses are `C…`
  // Soroban contracts, so nothing here may lean on a single address shape. The
  // one thing the SDK must get right is that the chain is genuinely non-EVM:
  // `isNonEvmChainId` is what routes a bare strkey recipient through unchanged
  // instead of demanding a hex `Address`.
  test('treats Stellar as a non-EVM destination', () => {
    const reference = parseCaip2('stellar:pubnet')
    expect(reference.kind).toBe('non-evm')
    expect(reference).toMatchObject({
      namespace: 'stellar',
      reference: 'pubnet',
    })
    expect(isNonEvmChainId(1500148)).toBe(true)
    expect(isEvmCaip2('stellar:pubnet')).toBe(false)
    expect(() => toEvmChainReference(1500148)).toThrow('not EVM-compatible')
  })

  // A descriptor is only as good as its wire-table entry: without one,
  // `parseCaip2(chain.caip2)` throws and `targetChain: <descriptor>` fails at
  // the first hop, while the descriptor itself still typechecks. Generic over
  // the exported set so the next chain cannot ship half-wired.
  test.each([
    ['solanaMainnet', solanaMainnet],
    ['tronMainnet', tronMainnet],
    ['stellarMainnet', stellarMainnet],
    ['hyperCoreSpot', hyperCoreSpot],
    ['hyperCorePerp', hyperCorePerp],
  ])('addresses the destination %s names', (_name, chain) => {
    expect(isCaip2(chain.caip2)).toBe(true)
    expect(formatCaip2(chainIdFromReference(parseCaip2(chain.caip2)))).toBe(
      chain.caip2,
    )
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
