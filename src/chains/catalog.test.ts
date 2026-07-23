import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { getChainById, getChainReference } from './catalog'
import { normalizeTokenAddress, validateTokenAddresses } from './tokens'

describe('runtime chain resolution', () => {
  test('resolves known viem chains and falls back for unknown ids', () => {
    expect(getChainById(arbitrum.id).id).toBe(arbitrum.id)
    expect(getChainById(base.id).name).toBe(base.name)

    // A chain viem doesn't know still resolves — signing must not be gated on
    // the SDK's bundled viem version.
    const unknown = getChainById(999_999_999_999)
    expect(unknown.id).toBe(999_999_999_999)
    expect(unknown.name).toBe('Chain 999999999999')
    expect(unknown.nativeCurrency.symbol).toBe('ETH')
  })

  test('materializes canonical references', () => {
    expect(getChainReference(base.id)).toEqual({
      kind: 'evm',
      id: base.id,
      caip2: `eip155:${base.id}`,
    })
    expect(getChainReference(792703809)).toMatchObject({
      kind: 'non-evm',
      namespace: 'solana',
    })
  })
})

describe('normalizeTokenAddress', () => {
  const usdc = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'

  test('passes addresses through and rejects EVM symbols', () => {
    expect(normalizeTokenAddress(usdc, arbitrum.id, false)).toBe(usdc)
    // Non-EVM chains pass their token identifiers through unchanged.
    expect(normalizeTokenAddress('mint', 792703809, true)).toBe('mint')
    // v2 no longer accepts symbols on EVM chains.
    expect(() => normalizeTokenAddress('USDC', arbitrum.id, false)).toThrow(
      'Expected a token address',
    )
  })

  test('validateTokenAddresses accepts addresses and rejects symbols', () => {
    expect(() => validateTokenAddresses([usdc])).not.toThrow()
    expect(() => validateTokenAddresses([usdc, 'USDC'])).toThrow(
      'Invalid token address: USDC',
    )
  })
})
