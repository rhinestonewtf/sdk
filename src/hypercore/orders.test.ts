import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import {
  HyperCoreError,
  MismatchedPerpAssetError,
  PerpOrderTooSmallError,
} from './errors'
import type { PerpMarket, PerpPosition } from './market'
import { closePerp, formatPerpPrice, formatPerpSize, openPerp } from './orders'

// szDecimals 5 leaves a price one decimal place, which is the tightest grid on
// Hyperliquid and where the rounding rules bite hardest.
const BTC: PerpMarket = {
  asset: 'BTC',
  assetIndex: 0,
  szDecimals: 5,
  maxLeverage: 40,
  markPx: '64250.5',
}

const HYPE: PerpMarket = {
  asset: 'HYPE',
  assetIndex: 159,
  szDecimals: 2,
  maxLeverage: 5,
  markPx: '38.123',
}

const decimalsOf = (value: string) => value.split('.')[1]?.length ?? 0
const significantFiguresOf = (value: string) =>
  value.replace('-', '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '')
    .length

describe('openPerp', () => {
  test('builds a marketable IOC in the requested direction', () => {
    const action = openPerp({
      market: BTC,
      direction: 'long',
      notionalUsd: 100,
    })

    expect(action.type).toBe('order')
    expect(action.grouping).toBe('na')
    expect(action.orders).toHaveLength(1)
    expect(action.orders[0]).toMatchObject({
      a: BTC.assetIndex,
      b: true,
      r: false,
      t: { limit: { tif: 'Ioc' } },
    })
  })

  test('prices a long above the mark and a short below it', () => {
    const long = openPerp({ market: BTC, direction: 'long', notionalUsd: 100 })
    const short = openPerp({
      market: BTC,
      direction: 'short',
      notionalUsd: 100,
    })

    expect(Number(long.orders[0].p)).toBeGreaterThan(Number(BTC.markPx))
    expect(Number(short.orders[0].p)).toBeLessThan(Number(BTC.markPx))
  })

  test('widens the limit with slippage, and 0 bps sits on the mark', () => {
    const tight = openPerp({
      market: HYPE,
      direction: 'long',
      notionalUsd: 100,
      slippageBps: 10,
    })
    const wide = openPerp({
      market: HYPE,
      direction: 'long',
      notionalUsd: 100,
      slippageBps: 500,
    })
    const none = openPerp({
      market: HYPE,
      direction: 'long',
      notionalUsd: 100,
      slippageBps: 0,
    })

    expect(Number(wide.orders[0].p)).toBeGreaterThan(Number(tight.orders[0].p))
    expect(none.orders[0].p).toBe('38.123')
  })

  // The asset index is what reaches the exchange; a ticker never does. An index
  // taken from the wrong market places a valid order on a different coin.
  test('carries the market its own asset index', () => {
    const action = openPerp({ market: HYPE, direction: 'long', size: '10' })
    expect(action.orders[0].a).toBe(159)
  })

  test('sizes a USD notional at the mark, rounded down to szDecimals', () => {
    const action = openPerp({
      market: BTC,
      direction: 'long',
      notionalUsd: 100,
    })

    // 100 / 64250.5 = 0.0015564…, floored to five decimals.
    expect(action.orders[0].s).toBe('0.00155')
    expect(Number(action.orders[0].s) * Number(BTC.markPx)).toBeLessThanOrEqual(
      100,
    )
  })

  test('takes an explicit size in asset units', () => {
    const action = openPerp({ market: BTC, direction: 'long', size: '0.002' })
    expect(action.orders[0].s).toBe('0.002')
  })

  // The action's bytes are what the authorising agent is derived from, and
  // Hyperliquid normalises before encoding, so "0.00200" is a different order.
  test('emits sizes and prices without trailing zeros', () => {
    const action = openPerp({
      market: HYPE,
      direction: 'long',
      size: '10.10',
      slippageBps: 0,
    })
    expect(action.orders[0].s).toBe('10.1')
    expect(action.orders[0].p).toBe('38.123')
  })

  test('omits the client order id unless one is given', () => {
    const withCloid = openPerp({
      market: BTC,
      direction: 'long',
      notionalUsd: 100,
      cloid: '0x1234567890abcdef1234567890abcdef',
    })
    const without = openPerp({
      market: BTC,
      direction: 'long',
      notionalUsd: 100,
    })

    expect(withCloid.orders[0].c).toBe('0x1234567890abcdef1234567890abcdef')
    expect('c' in without.orders[0]).toBe(false)
  })

  // Refused at the exchange, which for an intent that delivers collateral means
  // refused after the funds have already landed on HyperCore.
  test('rejects an order below the exchange minimum', () => {
    expect(() =>
      openPerp({ market: BTC, direction: 'long', notionalUsd: 5 }),
    ).toThrow(PerpOrderTooSmallError)
  })

  test('rejects a size that rounds away to nothing', () => {
    expect(() =>
      openPerp({ market: BTC, direction: 'long', size: '0.000001' }),
    ).toThrow(HyperCoreError)
  })

  test('rejects slippage that is not whole basis points in range', () => {
    for (const slippageBps of [-1, 0.5, 10_001]) {
      expect(() =>
        openPerp({
          market: BTC,
          direction: 'long',
          notionalUsd: 100,
          slippageBps,
        }),
      ).toThrow(HyperCoreError)
    }
  })

  test('rejects a market with no usable mark price', () => {
    expect(() =>
      openPerp({
        market: { ...BTC, markPx: '' },
        direction: 'long',
        notionalUsd: 100,
      }),
    ).toThrow(HyperCoreError)
  })
})

describe('closePerp', () => {
  const long: PerpPosition = {
    asset: 'BTC',
    size: '0.0013',
    entryPx: '63000',
    leverage: 5,
  }
  const short: PerpPosition = { ...long, size: '-0.0013' }

  test('sells a long, reduce-only, for the whole position', () => {
    const action = closePerp({ market: BTC, position: long })

    expect(action.orders[0]).toMatchObject({
      a: BTC.assetIndex,
      b: false,
      s: '0.0013',
      r: true,
      t: { limit: { tif: 'Ioc' } },
    })
    expect(Number(action.orders[0].p)).toBeLessThan(Number(BTC.markPx))
  })

  test('buys back a short', () => {
    const action = closePerp({ market: BTC, position: short })

    expect(action.orders[0].b).toBe(true)
    expect(action.orders[0].s).toBe('0.0013')
    expect(Number(action.orders[0].p)).toBeGreaterThan(Number(BTC.markPx))
  })

  test('closes only part of a position when asked', () => {
    const action = closePerp({ market: BTC, position: long, size: '0.0005' })
    expect(action.orders[0].s).toBe('0.0005')
  })

  test('refuses to close more than is open', () => {
    expect(() =>
      closePerp({ market: BTC, position: long, size: '0.002' }),
    ).toThrow(HyperCoreError)
  })

  // An order carries the market's index, so a mismatch would flatten nothing
  // and open a position on the other coin instead.
  test('refuses a market and a position for different assets', () => {
    expect(() => closePerp({ market: HYPE, position: long })).toThrow(
      MismatchedPerpAssetError,
    )
  })

  // Hyperliquid exempts reduce-only orders from the minimum; enforcing it here
  // would leave a dust position with no way out.
  test('closes a position worth less than the order minimum', () => {
    const dust: PerpPosition = { ...long, size: '0.00001' }
    expect(closePerp({ market: BTC, position: dust }).orders[0].s).toBe(
      '0.00001',
    )
  })
})

describe('price and size grids', () => {
  test.each([
    // price, szDecimals, roundUp, expected
    [64571.7525, 5, true, '64572'],
    [63929.2475, 5, false, '63929'],
    [38.313615, 2, true, '38.314'],
    [37.932385, 2, false, '37.932'],
  ] as const)(
    'rounds %f onto the grid for szDecimals %i',
    (price, szDecimals, roundUp, expected) => {
      expect(formatPerpPrice(price, szDecimals, roundUp)).toBe(expected)
    },
  )

  test('floors a size onto the asset grid', () => {
    expect(formatPerpSize(0.0015564, 5)).toBe('0.00155')
    expect(formatPerpSize(10.999, 0)).toBe('10')
  })

  // The two rules Hyperliquid enforces on a perp price, and the one that makes
  // the order marketable at all. Rounding onto the grid must not undo the
  // slippage the caller asked for.
  test('stays on the grid and on the marketable side of the mark', () => {
    fc.assert(
      fc.property(
        // A mark as the info endpoint reports one: a plain decimal string.
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.boolean(),
        (mantissa, markDecimals, szDecimals, slippageBps, isLong) => {
          const markPx = (mantissa / 10 ** markDecimals).toFixed(markDecimals)
          const mark = Number(markPx)
          const market: PerpMarket = {
            asset: 'TEST',
            assetIndex: 1,
            szDecimals,
            maxLeverage: 10,
            markPx,
          }
          const { p } = openPerp({
            market,
            direction: isLong ? 'long' : 'short',
            // Clear the exchange minimum without rounding away on a coarse grid.
            size: String(Math.max(20 / mark, 10 ** -szDecimals)),
            slippageBps,
          }).orders[0]

          expect(decimalsOf(p)).toBeLessThanOrEqual(Math.max(0, 6 - szDecimals))
          expect(significantFiguresOf(p)).toBeLessThanOrEqual(5)
          if (isLong) expect(Number(p)).toBeGreaterThanOrEqual(mark)
          else expect(Number(p)).toBeLessThanOrEqual(mark)
        },
      ),
    )
  })
})
