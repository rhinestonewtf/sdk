import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import {
  HyperCoreError,
  NoOpenPerpPositionError,
  PerpOrderTooSmallError,
  UnknownPerpAssetError,
} from './errors'
import type { HyperCoreInfoOptions } from './market'
import { closePerp, formatPerpPrice, formatPerpSize, openPerp } from './orders'

const ACCOUNT = '0x1111111111111111111111111111111111111111' as const

interface StubMarket {
  name: string
  szDecimals: number
  maxLeverage: number
  markPx: string
}

// szDecimals 5 leaves a price one decimal place, which is the tightest grid on
// Hyperliquid and where the rounding rules bite hardest.
const BTC: StubMarket = {
  name: 'BTC',
  szDecimals: 5,
  maxLeverage: 40,
  markPx: '64250.5',
}

const HYPE: StubMarket = {
  name: 'HYPE',
  szDecimals: 2,
  maxLeverage: 5,
  markPx: '38.123',
}

/** Answers the two info calls the builders make, from in-memory fixtures. */
function stubInfo(input: {
  markets?: StubMarket[]
  positions?: { coin: string; szi: string }[]
}): HyperCoreInfoOptions {
  const markets = input.markets ?? [BTC, HYPE]
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { type?: string }
    const payload =
      body.type === 'clearinghouseState'
        ? {
            assetPositions: (input.positions ?? []).map((position) => ({
              type: 'oneWay',
              position: { ...position, entryPx: '1', leverage: { value: 5 } },
            })),
          }
        : [
            { universe: markets.map(({ markPx: _markPx, ...rest }) => rest) },
            markets.map(({ markPx }) => ({ markPx })),
          ]
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { fetch }
}

describe('openPerp', () => {
  test('builds a marketable IOC in the requested direction', async () => {
    const action = await openPerp(
      { asset: 'BTC', direction: 'long', notionalUsd: 100 },
      stubInfo({}),
    )

    expect(action.type).toBe('order')
    expect(action.grouping).toBe('na')
    expect(action.orders).toHaveLength(1)
    expect(action.orders[0]).toMatchObject({
      a: 0,
      b: true,
      r: false,
      t: { limit: { tif: 'Ioc' } },
    })
  })

  test('prices a long above the mark and a short below it', async () => {
    const long = await openPerp(
      { asset: 'BTC', direction: 'long', notionalUsd: 100 },
      stubInfo({}),
    )
    const short = await openPerp(
      { asset: 'BTC', direction: 'short', notionalUsd: 100 },
      stubInfo({}),
    )

    expect(Number(long.orders[0].p)).toBeGreaterThan(Number(BTC.markPx))
    expect(Number(short.orders[0].p)).toBeLessThan(Number(BTC.markPx))
  })

  test('widens the limit with slippage, and 0 bps sits on the mark', async () => {
    const price = async (slippageBps: number) =>
      (
        await openPerp(
          { asset: 'HYPE', direction: 'long', notionalUsd: 100, slippageBps },
          stubInfo({}),
        )
      ).orders[0].p

    expect(Number(await price(500))).toBeGreaterThan(Number(await price(10)))
    expect(await price(0)).toBe('38.123')
  })

  // The asset index is what reaches the exchange; a ticker never does. Resolving
  // it is the whole reason these builders read the market themselves.
  test('resolves the ticker to its index in the universe', async () => {
    const action = await openPerp(
      { asset: 'HYPE', direction: 'long', size: '10' },
      stubInfo({}),
    )
    expect(action.orders[0].a).toBe(1)
  })

  test('rejects a ticker no tradeable market carries', async () => {
    await expect(
      openPerp(
        { asset: 'BTC-PERP', direction: 'long', size: '1' },
        stubInfo({}),
      ),
    ).rejects.toThrow(UnknownPerpAssetError)
  })

  test('sizes a USD notional at the mark, rounded down to szDecimals', async () => {
    const action = await openPerp(
      { asset: 'BTC', direction: 'long', notionalUsd: 100 },
      stubInfo({}),
    )

    // 100 / 64250.5 = 0.0015564…, floored to five decimals.
    expect(action.orders[0].s).toBe('0.00155')
    expect(Number(action.orders[0].s) * Number(BTC.markPx)).toBeLessThanOrEqual(
      100,
    )
  })

  test('takes an explicit size in asset units', async () => {
    const action = await openPerp(
      { asset: 'BTC', direction: 'long', size: '0.002' },
      stubInfo({}),
    )
    expect(action.orders[0].s).toBe('0.002')
  })

  // The action's bytes are what the authorising agent is derived from, and
  // Hyperliquid normalises before encoding, so "0.00200" is a different order.
  test('emits sizes and prices without trailing zeros', async () => {
    const action = await openPerp(
      { asset: 'HYPE', direction: 'long', size: '10.10', slippageBps: 0 },
      stubInfo({}),
    )
    expect(action.orders[0].s).toBe('10.1')
    expect(action.orders[0].p).toBe('38.123')
  })

  test('omits the client order id unless one is given', async () => {
    const withCloid = await openPerp(
      {
        asset: 'BTC',
        direction: 'long',
        notionalUsd: 100,
        cloid: '0x1234567890abcdef1234567890abcdef',
      },
      stubInfo({}),
    )
    const without = await openPerp(
      { asset: 'BTC', direction: 'long', notionalUsd: 100 },
      stubInfo({}),
    )

    expect(withCloid.orders[0].c).toBe('0x1234567890abcdef1234567890abcdef')
    expect('c' in without.orders[0]).toBe(false)
  })

  // Refused at the exchange, which for an intent that delivers collateral means
  // refused after the funds have already landed on HyperCore.
  test('rejects an order below the exchange minimum', async () => {
    await expect(
      openPerp(
        { asset: 'BTC', direction: 'long', notionalUsd: 5 },
        stubInfo({}),
      ),
    ).rejects.toThrow(PerpOrderTooSmallError)
  })

  // Flooring the size means a notional barely over the minimum can land under
  // it, so the message reports the size it actually built rather than the
  // number the caller passed — otherwise it reads as an off-by-nothing lie.
  test('reports the rounded size that fell short, not the request', async () => {
    // 10 / 64250.5 floors to 0.00015 at five decimals, which is $9.64.
    await expect(
      openPerp(
        { asset: 'BTC', direction: 'long', notionalUsd: 10 },
        stubInfo({}),
      ),
    ).rejects.toThrow(/0\.00015 is worth \$9\.64/)
  })

  test('rejects a size that rounds away to nothing', async () => {
    await expect(
      openPerp(
        { asset: 'BTC', direction: 'long', size: '0.000001' },
        stubInfo({}),
      ),
    ).rejects.toThrow(HyperCoreError)
  })

  test('rejects slippage that is not whole basis points in range', async () => {
    for (const slippageBps of [-1, 0.5, 10_001]) {
      await expect(
        openPerp(
          { asset: 'BTC', direction: 'long', notionalUsd: 100, slippageBps },
          stubInfo({}),
        ),
      ).rejects.toThrow(HyperCoreError)
    }
  })

  test('rejects a market with no usable mark price', async () => {
    await expect(
      openPerp(
        { asset: 'BTC', direction: 'long', notionalUsd: 100 },
        stubInfo({ markets: [{ ...BTC, markPx: '' }] }),
      ),
    ).rejects.toThrow(HyperCoreError)
  })
})

describe('closePerp', () => {
  const long = stubInfo({ positions: [{ coin: 'BTC', szi: '0.0013' }] })
  const short = stubInfo({ positions: [{ coin: 'BTC', szi: '-0.0013' }] })

  test('sells a long, reduce-only, for the whole position', async () => {
    const action = await closePerp({ asset: 'BTC', account: ACCOUNT }, long)

    expect(action.orders[0]).toMatchObject({
      a: 0,
      b: false,
      s: '0.0013',
      r: true,
      t: { limit: { tif: 'Ioc' } },
    })
    expect(Number(action.orders[0].p)).toBeLessThan(Number(BTC.markPx))
  })

  test('buys back a short', async () => {
    const action = await closePerp({ asset: 'BTC', account: ACCOUNT }, short)

    expect(action.orders[0].b).toBe(true)
    expect(action.orders[0].s).toBe('0.0013')
    expect(Number(action.orders[0].p)).toBeGreaterThan(Number(BTC.markPx))
  })

  test('closes only part of a position when asked', async () => {
    const action = await closePerp(
      { asset: 'BTC', account: ACCOUNT, size: '0.0005' },
      long,
    )
    expect(action.orders[0].s).toBe('0.0005')
  })

  test('refuses to close more than is open', async () => {
    await expect(
      closePerp({ asset: 'BTC', account: ACCOUNT, size: '0.002' }, long),
    ).rejects.toThrow(HyperCoreError)
  })

  // Naming the asset once is what makes a market/position mismatch impossible,
  // so the only thing left to get wrong is closing what is not there.
  test('refuses to close a position the account does not hold', async () => {
    await expect(
      closePerp({ asset: 'HYPE', account: ACCOUNT }, long),
    ).rejects.toThrow(NoOpenPerpPositionError)
  })

  // Hyperliquid exempts reduce-only orders from the minimum; enforcing it here
  // would leave a dust position with no way out.
  test('closes a position worth less than the order minimum', async () => {
    const dust = stubInfo({ positions: [{ coin: 'BTC', szi: '0.00001' }] })
    const action = await closePerp({ asset: 'BTC', account: ACCOUNT }, dust)
    expect(action.orders[0].s).toBe('0.00001')
  })
})

describe('price and size grids', () => {
  const decimalsOf = (value: string) => value.split('.')[1]?.length ?? 0
  const significantFiguresOf = (value: string) =>
    value
      .replace('-', '')
      .replace('.', '')
      .replace(/^0+/, '')
      .replace(/0+$/, '').length

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
  test('stays on the grid and on the marketable side of the mark', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A mark as the info endpoint reports one: a plain decimal string.
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.boolean(),
        async (mantissa, markDecimals, szDecimals, slippageBps, isLong) => {
          const markPx = (mantissa / 10 ** markDecimals).toFixed(markDecimals)
          const mark = Number(markPx)
          const { p } = (
            await openPerp(
              {
                asset: 'TEST',
                direction: isLong ? 'long' : 'short',
                // Clear the minimum without rounding away on a coarse grid.
                size: String(Math.max(20 / mark, 10 ** -szDecimals)),
                slippageBps,
              },
              stubInfo({
                markets: [
                  { name: 'TEST', szDecimals, maxLeverage: 10, markPx },
                ],
              }),
            )
          ).orders[0]

          expect(decimalsOf(p)).toBeLessThanOrEqual(Math.max(0, 6 - szDecimals))
          expect(significantFiguresOf(p)).toBeLessThanOrEqual(5)
          if (isLong) expect(Number(p)).toBeGreaterThanOrEqual(mark)
          else expect(Number(p)).toBeLessThanOrEqual(mark)
        },
      ),
    )
  })
})
