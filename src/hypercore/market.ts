// Reads of Hyperliquid's public `info` endpoint — the market metadata an order
// needs and cannot be derived: the asset INDEX an order carries, the size
// precision it must round to, and the mark to price against.
//
// Separate from the order builders on purpose. The mark is a snapshot, and the
// limit price built from it is fixed when the intent is signed, so the read is
// the caller's to place and to repeat.

import type { Address } from 'viem'
import { HyperCoreInfoRequestError, UnknownPerpAssetError } from './errors'

/** Hyperliquid's mainnet API. */
const HYPERLIQUID_API_URL = 'https://api.hyperliquid.xyz'

type FetchPort = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

/** Where and how to reach Hyperliquid's info endpoint. */
interface HyperCoreInfoOptions {
  /** Base API URL. Defaults to Hyperliquid mainnet. */
  apiUrl?: string
  /** Fetch implementation. Defaults to the global one. */
  fetch?: FetchPort
}

/** A Hyperliquid perpetual market. */
interface PerpMarket {
  /** Ticker, as Hyperliquid names it — the coin alone, e.g. `BTC`. */
  asset: string
  /**
   * Index of the asset in Hyperliquid's perp universe. This is what an order
   * carries; the ticker never reaches the exchange.
   */
  assetIndex: number
  /** Decimal places a size may carry. */
  szDecimals: number
  /** Highest leverage the asset allows. */
  maxLeverage: number
  /** Current mark price, as a decimal string. */
  markPx: string
}

/** An open position on a Hyperliquid perpetual market. */
interface PerpPosition {
  /** Ticker, as Hyperliquid names it. */
  asset: string
  /**
   * Position size in asset units, signed: positive is long, negative is short.
   * The sign is the only record of the side — `closePerp` reads it to pick the
   * direction that reduces the position.
   */
  size: string
  /** Average entry price, as a decimal string. */
  entryPx: string
  /** Leverage the position is held at. */
  leverage: number
}

interface UniverseEntry {
  name: string
  szDecimals: number
  maxLeverage: number
  isDelisted?: boolean
}

type MetaAndAssetCtxs = [
  { universe: UniverseEntry[] },
  { markPx?: string | null }[],
]

interface ClearinghouseState {
  assetPositions?: {
    position?: {
      coin?: string
      szi?: string
      entryPx?: string | null
      leverage?: { value?: number }
    }
  }[]
}

async function readInfo<T>(
  body: unknown,
  options: HyperCoreInfoOptions | undefined,
): Promise<T> {
  const url = `${options?.apiUrl ?? HYPERLIQUID_API_URL}/info`
  const request = options?.fetch ?? globalThis.fetch
  const response = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new HyperCoreInfoRequestError(url, response.status, text)
  }
  return (await response.json()) as T
}

/**
 * List every tradeable Hyperliquid perpetual market.
 *
 * Delisted assets are left out, but the index of the ones returned is their
 * position in the full universe — Hyperliquid never renumbers it, and it is
 * what an order carries.
 *
 * @param options where to reach Hyperliquid's info endpoint
 * @returns one entry per tradeable perp market, with a live mark price
 * @example
 * const markets = await getPerpMarkets()
 * markets.map((market) => market.asset) // ['BTC', 'ETH', ...]
 * @see {@link getPerpMarket}
 */
async function getPerpMarkets(
  options?: HyperCoreInfoOptions,
): Promise<PerpMarket[]> {
  const [meta, contexts] = await readInfo<MetaAndAssetCtxs>(
    { type: 'metaAndAssetCtxs' },
    options,
  )
  return meta.universe
    .map((entry, assetIndex) => ({ entry, assetIndex }))
    .filter(({ entry }) => !entry.isDelisted)
    .map(({ entry, assetIndex }) => ({
      asset: entry.name,
      assetIndex,
      szDecimals: entry.szDecimals,
      maxLeverage: entry.maxLeverage,
      markPx: contexts[assetIndex]?.markPx ?? '',
    }))
}

/**
 * Read one Hyperliquid perpetual market by ticker.
 *
 * The result is what {@link openPerp} and {@link closePerp} price and size
 * against, so read it immediately before building the action: `markPx` is a
 * snapshot, and the limit price derived from it is fixed once the intent is
 * signed.
 *
 * @param asset ticker as Hyperliquid names it — the coin alone, e.g. `BTC`
 * @param options where to reach Hyperliquid's info endpoint
 * @returns the market, including its asset index, size precision, and mark
 * @throws {UnknownPerpAssetError} if no tradeable market carries that ticker
 * @example
 * const market = await getPerpMarket('BTC')
 * @see {@link openPerp}
 */
async function getPerpMarket(
  asset: string,
  options?: HyperCoreInfoOptions,
): Promise<PerpMarket> {
  const markets = await getPerpMarkets(options)
  const market = markets.find((entry) => entry.asset === asset)
  if (!market) throw new UnknownPerpAssetError(asset)
  return market
}

/**
 * List an account's open Hyperliquid perpetual positions.
 *
 * @param account the account holding the positions — the smart account itself,
 *   since that is what the intent delivers collateral to
 * @param options where to reach Hyperliquid's info endpoint
 * @returns one entry per open position; empty when the account holds none
 * @see {@link getPerpPosition}
 */
async function getPerpPositions(
  account: Address,
  options?: HyperCoreInfoOptions,
): Promise<PerpPosition[]> {
  const state = await readInfo<ClearinghouseState>(
    { type: 'clearinghouseState', user: account },
    options,
  )
  return (state.assetPositions ?? []).flatMap(({ position }) =>
    position?.coin && position.szi
      ? [
          {
            asset: position.coin,
            size: position.szi,
            entryPx: position.entryPx ?? '0',
            leverage: position.leverage?.value ?? 1,
          },
        ]
      : [],
  )
}

/**
 * Read an account's open position on one Hyperliquid perpetual market.
 *
 * @param account the account holding the position
 * @param asset ticker as Hyperliquid names it, e.g. `BTC`
 * @param options where to reach Hyperliquid's info endpoint
 * @returns the position, or `null` when the account has none open on that asset
 * @example
 * const position = await getPerpPosition(account.getAddress(), 'BTC')
 * if (position) {
 *   const action = closePerp({ market, position })
 * }
 * @see {@link closePerp}
 */
async function getPerpPosition(
  account: Address,
  asset: string,
  options?: HyperCoreInfoOptions,
): Promise<PerpPosition | null> {
  const positions = await getPerpPositions(account, options)
  return positions.find((position) => position.asset === asset) ?? null
}

export { getPerpMarket, getPerpMarkets, getPerpPosition, getPerpPositions }
export type { HyperCoreInfoOptions, PerpMarket, PerpPosition }
