import type { Address } from 'viem'
import { arbitrum, mainnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { createCrossChainPermission } from './smart-sessions'

// Concrete addresses skip the TokenSymbol registry path so these tests stay
// independent of shared-configs registry contents.
const TOKEN_A = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address
const TOKEN_B = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address
const RECIPIENT = '0x5555555555555555555555555555555555555555' as Address

describe('createCrossChainPermission', () => {
  test('normalises single from/to into arrays', () => {
    const permit = createCrossChainPermission({
      from: { chain: mainnet, token: TOKEN_A },
      to: { chain: arbitrum, token: TOKEN_B },
    })
    expect(permit.from).toEqual([
      { chain: mainnet, token: TOKEN_A, maxAmount: undefined },
    ])
    expect(permit.to).toEqual([
      { chain: arbitrum, token: TOKEN_B, recipient: undefined },
    ])
  })

  test('preserves arrays of multiple legs', () => {
    const permit = createCrossChainPermission({
      from: [
        { chain: mainnet, token: TOKEN_A, maxAmount: 1000n },
        { chain: mainnet, token: TOKEN_A },
      ],
      to: [
        { chain: arbitrum, token: TOKEN_B, recipient: RECIPIENT },
        { chain: arbitrum, token: TOKEN_B, recipient: 'any' },
      ],
    })
    expect(permit.from).toHaveLength(2)
    expect(permit.to).toHaveLength(2)
    expect(permit.from[0].maxAmount).toBe(1000n)
    expect(permit.to[0].recipient).toBe(RECIPIENT)
    expect(permit.to[1].recipient).toBe('any')
  })

  test('Date → unix-seconds bigint conversion', () => {
    const validUntil = new Date('2030-01-01T00:00:00Z')
    const expectedSeconds = BigInt(Math.floor(validUntil.getTime() / 1000))
    const permit = createCrossChainPermission({
      from: { chain: mainnet, token: TOKEN_A },
      to: { chain: arbitrum, token: TOKEN_B },
      validUntil,
    })
    expect(permit.validUntil).toBe(expectedSeconds)
  })

  test('bigint passthrough on validUntil/validAfter', () => {
    const permit = createCrossChainPermission({
      from: { chain: mainnet, token: TOKEN_A },
      to: { chain: arbitrum, token: TOKEN_B },
      validUntil: 9_999_999n,
      validAfter: 1_000_000n,
    })
    expect(permit.validUntil).toBe(9_999_999n)
    expect(permit.validAfter).toBe(1_000_000n)
  })

  test('omitting settlementLayers leaves field undefined (resolver expands to "any supported")', () => {
    // The helper passes the field through verbatim; expansion to the
    // union of supported layers happens at session-data build time in
    // getArbitersForSettlementLayers.
    const permit = createCrossChainPermission({
      from: { chain: mainnet, token: TOKEN_A },
      to: { chain: arbitrum, token: TOKEN_B },
    })
    expect(permit.settlementLayers).toBeUndefined()
  })

  test('settlementLayers override is preserved verbatim (subset)', () => {
    const permit = createCrossChainPermission({
      from: { chain: mainnet, token: TOKEN_A },
      to: { chain: arbitrum, token: TOKEN_B },
      settlementLayers: ['ECO'],
    })
    expect(permit.settlementLayers).toEqual(['ECO'])
  })

  test('recipientIsAccount defaults to true (bridge-to-self enforced)', () => {
    const permit = createCrossChainPermission({
      from: { chain: mainnet, token: TOKEN_A },
      to: { chain: arbitrum, token: TOKEN_B },
    })
    expect(permit.recipientIsAccount).toBe(true)
  })

  test('allowRecipientNotAccount: true disables the bridge-to-self check', () => {
    const permit = createCrossChainPermission({
      from: { chain: mainnet, token: TOKEN_A },
      to: { chain: arbitrum, token: TOKEN_B },
      allowRecipientNotAccount: true,
    })
    expect(permit.recipientIsAccount).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Adversarial / boundary cases
  // -------------------------------------------------------------------------

  test('omitted from/to → undefined (no token restriction on that side)', () => {
    // Both sides optional: a permit with neither still expresses "any
    // cross-chain move through these arbiters, locked to self, within
    // this deadline". Mirrors how the underlying Permit2 policy treats
    // absent token lists.
    const permit = createCrossChainPermission({
      validUntil: 9_999_999n,
      settlementLayers: ['ECO'],
    })
    expect(permit.from).toBeUndefined()
    expect(permit.to).toBeUndefined()
  })

  test('empty arrays normalise to undefined (treated as no restriction)', () => {
    const permit = createCrossChainPermission({
      from: [],
      to: [],
    })
    expect(permit.from).toBeUndefined()
    expect(permit.to).toBeUndefined()
  })

  test('one side present, other omitted', () => {
    const permit = createCrossChainPermission({
      to: { chain: arbitrum, token: TOKEN_B },
    })
    expect(permit.from).toBeUndefined()
    expect(permit.to).toEqual([
      { chain: arbitrum, token: TOKEN_B, recipient: undefined },
    ])
  })

  test('validAfter > validUntil throws at build time', () => {
    expect(() =>
      createCrossChainPermission({
        from: { chain: mainnet, token: TOKEN_A },
        to: { chain: arbitrum, token: TOKEN_B },
        validAfter: 9_999n,
        validUntil: 1_000n,
      }),
    ).toThrow(/validAfter.*greater than validUntil/)
  })

  test('validAfter == validUntil is allowed (single-instant window)', () => {
    expect(() =>
      createCrossChainPermission({
        from: { chain: mainnet, token: TOKEN_A },
        to: { chain: arbitrum, token: TOKEN_B },
        validAfter: 1_000n,
        validUntil: 1_000n,
      }),
    ).not.toThrow()
  })

  test('maxAmount = 0n is preserved (not coerced away)', () => {
    const permit = createCrossChainPermission({
      from: { chain: mainnet, token: TOKEN_A, maxAmount: 0n },
      to: { chain: arbitrum, token: TOKEN_B },
    })
    expect(permit.from[0].maxAmount).toBe(0n)
  })

  test('undefined validUntil/validAfter stay undefined (no implicit defaults)', () => {
    const permit = createCrossChainPermission({
      from: { chain: mainnet, token: TOKEN_A },
      to: { chain: arbitrum, token: TOKEN_B },
    })
    expect(permit.validUntil).toBeUndefined()
    expect(permit.validAfter).toBeUndefined()
  })

  test('Date inputs at unix epoch boundary convert cleanly', () => {
    const permit = createCrossChainPermission({
      from: { chain: mainnet, token: TOKEN_A },
      to: { chain: arbitrum, token: TOKEN_B },
      validAfter: new Date(0),
    })
    expect(permit.validAfter).toBe(0n)
  })
})
