import { describe, expect, test } from 'vitest'
import { HyperCoreInfoRequestError, UnknownPerpAssetError } from './errors'
import {
  getPerpMarket,
  getPerpMarkets,
  getPerpPosition,
  getPerpPositions,
} from './market'

const ACCOUNT = '0x1111111111111111111111111111111111111111' as const

const META_AND_CTXS = [
  {
    universe: [
      { name: 'BTC', szDecimals: 5, maxLeverage: 40 },
      { name: 'GONE', szDecimals: 2, maxLeverage: 3, isDelisted: true },
      { name: 'HYPE', szDecimals: 2, maxLeverage: 5 },
    ],
  },
  [{ markPx: '64250.5' }, { markPx: '0.1' }, { markPx: '38.123' }],
]

const CLEARINGHOUSE = {
  assetPositions: [
    {
      type: 'oneWay',
      position: {
        coin: 'BTC',
        szi: '0.0013',
        entryPx: '63000.0',
        leverage: { type: 'cross', value: 5 },
      },
    },
    { type: 'oneWay', position: { coin: 'HYPE', szi: '-42.0' } },
  ],
}

type Call = { url: string; body: unknown }

function stubFetch(response: unknown, status = 200) {
  const calls: Call[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? 'null')),
    })
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { fetch, calls }
}

describe('getPerpMarkets', () => {
  test('pairs each universe entry with its asset context', async () => {
    const { fetch, calls } = stubFetch(META_AND_CTXS)
    const markets = await getPerpMarkets({ fetch })

    expect(calls[0].url).toBe('https://api.hyperliquid.xyz/info')
    expect(calls[0].body).toEqual({ type: 'metaAndAssetCtxs' })
    expect(markets[0]).toEqual({
      asset: 'BTC',
      assetIndex: 0,
      szDecimals: 5,
      maxLeverage: 40,
      markPx: '64250.5',
    })
  })

  // Hyperliquid keeps delisted assets in the universe so the indices of every
  // other asset stay put. Dropping them must not renumber what is left.
  test('drops delisted assets without renumbering the rest', async () => {
    const { fetch } = stubFetch(META_AND_CTXS)
    const markets = await getPerpMarkets({ fetch })

    expect(markets.map((market) => market.asset)).toEqual(['BTC', 'HYPE'])
    expect(markets[1]).toMatchObject({ assetIndex: 2, markPx: '38.123' })
  })

  test('takes an alternative API base', async () => {
    const { fetch, calls } = stubFetch(META_AND_CTXS)
    await getPerpMarkets({
      fetch,
      apiUrl: 'https://api.hyperliquid-testnet.xyz',
    })

    expect(calls[0].url).toBe('https://api.hyperliquid-testnet.xyz/info')
  })

  test('reports a failed info request with its status', async () => {
    const { fetch } = stubFetch({ error: 'nope' }, 503)
    await expect(getPerpMarkets({ fetch })).rejects.toThrow(
      HyperCoreInfoRequestError,
    )
  })
})

describe('getPerpMarket', () => {
  test('finds a market by ticker', async () => {
    const { fetch } = stubFetch(META_AND_CTXS)
    expect(await getPerpMarket('HYPE', { fetch })).toMatchObject({
      assetIndex: 2,
    })
  })

  test('rejects an unknown ticker rather than guessing an index', async () => {
    const { fetch } = stubFetch(META_AND_CTXS)
    await expect(getPerpMarket('BTC-PERP', { fetch })).rejects.toThrow(
      UnknownPerpAssetError,
    )
  })

  test('treats a delisted asset as unknown', async () => {
    const { fetch } = stubFetch(META_AND_CTXS)
    await expect(getPerpMarket('GONE', { fetch })).rejects.toThrow(
      UnknownPerpAssetError,
    )
  })
})

describe('positions', () => {
  test('reads an account clearinghouse state', async () => {
    const { fetch, calls } = stubFetch(CLEARINGHOUSE)
    const positions = await getPerpPositions(ACCOUNT, { fetch })

    expect(calls[0].body).toEqual({
      type: 'clearinghouseState',
      user: ACCOUNT,
    })
    expect(positions).toEqual([
      { asset: 'BTC', size: '0.0013', entryPx: '63000.0', leverage: 5 },
      { asset: 'HYPE', size: '-42.0', entryPx: '0', leverage: 1 },
    ])
  })

  test('keeps the sign of a short, which is the only record of the side', async () => {
    const { fetch } = stubFetch(CLEARINGHOUSE)
    const position = await getPerpPosition(ACCOUNT, 'HYPE', { fetch })

    expect(position?.size).toBe('-42.0')
  })

  test('answers null for an asset the account holds no position on', async () => {
    const { fetch } = stubFetch(CLEARINGHOUSE)
    expect(await getPerpPosition(ACCOUNT, 'SOL', { fetch })).toBeNull()
  })

  test('answers nothing for an account with no positions', async () => {
    const { fetch } = stubFetch({})
    expect(await getPerpPositions(ACCOUNT, { fetch })).toEqual([])
  })
})
