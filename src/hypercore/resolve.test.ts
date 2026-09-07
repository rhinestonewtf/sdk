import { describe, expect, test } from 'vitest'
import { NoOpenPerpPositionError, UnknownPerpAssetError } from './errors'
import type { HyperliquidConfig } from './market'
import { resolveHyperCoreAction } from './resolve'

const ACCOUNT = '0x1111111111111111111111111111111111111111' as const

interface StubMarket {
  name: string
  szDecimals: number
  maxLeverage: number
  markPx: string
}

const BTC: StubMarket = {
  name: 'BTC',
  szDecimals: 5,
  maxLeverage: 40,
  markPx: '64250.5',
}

/** Answers the two info calls the resolver makes, from in-memory fixtures. */
function stubInfo(input: {
  markets?: StubMarket[]
  positions?: { coin: string; szi: string }[]
}) {
  const markets = input.markets ?? [BTC]
  const calls: unknown[] = []
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { type?: string }
    calls.push(body)
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
  return { hyperliquid: { fetch } as HyperliquidConfig, calls }
}

describe('resolveHyperCoreAction', () => {
  test('leaves a transaction without a HyperCore option alone', async () => {
    const { hyperliquid, calls } = stubInfo({})
    expect(
      await resolveHyperCoreAction({
        options: undefined,
        account: ACCOUNT,
        hyperliquid,
      }),
    ).toBeUndefined()
    // Nothing to resolve means nothing to read; every other transaction in the
    // SDK would otherwise pay for a Hyperliquid round trip.
    expect(calls).toHaveLength(0)
  })

  // The escape hatch is a pass-through in the strictest sense: the bytes the
  // caller wrote are the bytes the agent is derived from, so touching them
  // would forge an agent for an action they did not ask for.
  test('passes a raw action through untouched, and reads nothing', async () => {
    const { hyperliquid, calls } = stubInfo({})
    const action = {
      type: 'updateLeverage',
      asset: 0,
      isCross: true,
      leverage: 5,
    } as const

    const resolved = await resolveHyperCoreAction({
      options: { action },
      account: ACCOUNT,
      hyperliquid,
    })

    expect(resolved).toBe(action)
    expect(calls).toHaveLength(0)
  })

  test('resolves openPerp against the live market', async () => {
    const { hyperliquid, calls } = stubInfo({})
    const action = await resolveHyperCoreAction({
      options: {
        openPerp: { asset: 'BTC', direction: 'long', notionalUsd: 100 },
      },
      account: ACCOUNT,
      hyperliquid,
    })

    expect(calls).toEqual([{ type: 'metaAndAssetCtxs' }])
    expect(action).toMatchObject({
      type: 'order',
      orders: [{ a: 0, b: true, s: '0.00155', r: false }],
    })
  })

  test('resolves closePerp against the account position', async () => {
    const { hyperliquid, calls } = stubInfo({
      positions: [{ coin: 'BTC', szi: '-0.0013' }],
    })
    const action = await resolveHyperCoreAction({
      options: { closePerp: { asset: 'BTC' } },
      account: ACCOUNT,
      hyperliquid,
    })

    expect(calls).toContainEqual({
      type: 'clearinghouseState',
      user: ACCOUNT,
    })
    // Short, so flattening it buys.
    expect(action).toMatchObject({
      type: 'order',
      orders: [{ b: true, s: '0.0013', r: true }],
    })
  })

  test('refuses to close a position the account does not hold', async () => {
    const { hyperliquid } = stubInfo({ positions: [] })
    await expect(
      resolveHyperCoreAction({
        options: { closePerp: { asset: 'BTC' } },
        account: ACCOUNT,
        hyperliquid,
      }),
    ).rejects.toThrow(NoOpenPerpPositionError)
  })

  test('rejects a ticker no tradeable market carries', async () => {
    const { hyperliquid } = stubInfo({})
    await expect(
      resolveHyperCoreAction({
        options: {
          openPerp: { asset: 'BTC-PERP', direction: 'long', size: '1' },
        },
        account: ACCOUNT,
        hyperliquid,
      }),
    ).rejects.toThrow(UnknownPerpAssetError)
  })
})
