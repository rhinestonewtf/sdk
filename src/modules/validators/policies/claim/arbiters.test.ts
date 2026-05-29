import { describe, expect, test } from 'vitest'
import { getArbitersForSettlementLayers } from './arbiters'

describe('getArbitersForSettlementLayers', () => {
  test('undefined / empty layers → union of ALL supported layers (any supported, not any address)', () => {
    // "any" must always mean "any of the supported arbiters," never an
    // empty whitelist that disables the on-chain check. Both undefined
    // and [] expand to the full known set.
    const fromUndefined = getArbitersForSettlementLayers(undefined)
    const fromEmpty = getArbitersForSettlementLayers([])
    const fromAllExplicit = getArbitersForSettlementLayers([
      'SAME_CHAIN',
      'ECO',
      'ACROSS',
    ])
    expect(fromUndefined).toBeDefined()
    expect(fromUndefined!.length).toBeGreaterThan(0)
    expect(fromEmpty).toEqual(fromUndefined)
    expect(fromAllExplicit).toEqual(fromUndefined)
  })

  test('narrowing to a subset produces strictly fewer arbiters than "any supported"', () => {
    const any = getArbitersForSettlementLayers([])!
    const ecoOnly = getArbitersForSettlementLayers(['ECO'])!
    expect(ecoOnly.length).toBeLessThan(any.length)
  })

  test('single ECO layer resolves to at least one ecoArbiter address', () => {
    const addrs = getArbitersForSettlementLayers(['ECO'])
    expect(addrs).toBeDefined()
    expect(addrs!.length).toBeGreaterThan(0)
  })

  test('ACROSS layer resolves to BOTH the 7579 and multicall arbiter impls', () => {
    const addrs = getArbitersForSettlementLayers(['ACROSS'])
    expect(addrs).toBeDefined()
    expect(addrs!.length).toBeGreaterThanOrEqual(2)
  })

  test('multiple layers union their arbiters', () => {
    const ecoOnly = getArbitersForSettlementLayers(['ECO'])!
    const acrossOnly = getArbitersForSettlementLayers(['ACROSS'])!
    const combined = getArbitersForSettlementLayers(['ECO', 'ACROSS'])!
    expect(combined.length).toBeGreaterThanOrEqual(ecoOnly.length)
    expect(combined.length).toBeGreaterThanOrEqual(acrossOnly.length)
    expect(combined.length).toBeLessThanOrEqual(
      ecoOnly.length + acrossOnly.length,
    )
  })

  test('addresses are deduplicated case-insensitively', () => {
    const addrs = getArbitersForSettlementLayers([
      'SAME_CHAIN',
      'ECO',
      'ACROSS',
    ])!
    const lower = addrs.map((a) => a.toLowerCase())
    expect(new Set(lower).size).toBe(lower.length)
  })

  test('dev contracts produce a different (or equal) set vs mainnet', () => {
    const mainnet = getArbitersForSettlementLayers(['ECO'], false)
    const dev = getArbitersForSettlementLayers(['ECO'], true)
    expect(mainnet).toBeDefined()
    expect(dev).toBeDefined()
  })

  test('duplicate layers do not produce duplicate addresses', () => {
    const single = getArbitersForSettlementLayers(['ECO'])!
    const doubled = getArbitersForSettlementLayers(['ECO', 'ECO'])!
    expect(doubled).toEqual(single)
  })
})
