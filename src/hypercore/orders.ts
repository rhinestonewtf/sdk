// Builders for the two HyperCore actions an intent usually carries: open a perp
// position, and close one. Pure — the market data they price against is an
// argument, read separately with `getPerpMarket` / `getPerpPosition`.
//
// What they absorb is Hyperliquid's order arithmetic: the asset index an order
// carries instead of a ticker, the tick and size grids a price and size must
// land on, and a limit priced far enough through the book to still cross when
// the intent delivers ~30s later. Anything past a marketable IOC — a resting
// limit, a bracket, a trigger — is expressible directly as a `HyperCoreAction`,
// which is fully typed.

import type { Hex } from 'viem'
import type {
  HyperCoreOrder,
  HyperCoreOrderAction,
} from '../clients/orchestrator/public'
import {
  HyperCoreError,
  MismatchedPerpAssetError,
  PerpOrderTooSmallError,
} from './errors'
import type { PerpMarket, PerpPosition } from './market'

/** How far through the mark a marketable limit is placed, when not given. */
const DEFAULT_SLIPPAGE_BPS = 50

/**
 * Hyperliquid's cap on a perp price's significant figures. Integer prices are
 * exempt from it, which we do not exploit — five figures is always accepted,
 * and at any price where the difference shows it is far inside the slippage.
 */
const MAX_PRICE_SIGNIFICANT_FIGURES = 5

/** A perp price may carry `6 - szDecimals` decimals. */
const PERP_PRICE_DECIMAL_BUDGET = 6

/** Hyperliquid refuses an order worth less than this. */
const MIN_ORDER_VALUE_USD = 10

/** Size, either as a USD notional to convert or in units of the asset. */
type PerpOrderSize =
  | {
      /**
       * Position size in USD, converted at the market's mark and rounded DOWN
       * to the asset's size precision, so the result never exceeds what you
       * asked for.
       *
       * This is the position's notional, not the collateral behind it — at 5x
       * leverage a $25 position needs $5 of margin, and it is the margin the
       * intent's `tokenRequests` deliver.
       */
      notionalUsd: number
      size?: never
    }
  | {
      /** Position size in units of the asset, e.g. `'0.0002'` BTC. */
      size: string
      notionalUsd?: never
    }

type OpenPerpParams = PerpOrderSize & {
  /** The market to trade, from {@link getPerpMarket}. */
  market: PerpMarket
  direction: 'long' | 'short'
  /**
   * How far through the mark to place the limit, in basis points. Defaults to
   * 50 (0.5%).
   *
   * The price is fixed when the intent is signed but the order is not placed
   * until the collateral has bridged, so this is the room the book is allowed
   * to move in between. Too tight and the order is refused with the funds
   * already on HyperCore.
   */
  slippageBps?: number
  /** Optional client order id — 128-bit hex — echoed back by the exchange. */
  cloid?: Hex
}

type ClosePerpParams = {
  /** The market the position is on, from {@link getPerpMarket}. */
  market: PerpMarket
  /** The position to close, from {@link getPerpPosition}. */
  position: PerpPosition
  /** Close only part of the position, in units of the asset. */
  size?: string
  /** How far through the mark to place the limit, in basis points. */
  slippageBps?: number
  /** Optional client order id — 128-bit hex — echoed back by the exchange. */
  cloid?: Hex
}

/**
 * Build a HyperCore action that opens a perpetual position.
 *
 * A marketable IOC order: it fills against the book at up to `slippageBps`
 * through the mark and cancels whatever is left, which is how a market order is
 * expressed on Hyperliquid. Pair it with `tokenRequests` that deliver the
 * margin — an open needs collateral, and the order is placed only once that
 * collateral has landed.
 *
 * @param params the market, direction, and size to open
 * @returns the action to pass as `hyperCore.action` on a transaction
 * @throws {PerpOrderTooSmallError} if the order is under Hyperliquid's $10 minimum
 * @example
 * const market = await getPerpMarket('BTC')
 *
 * const prepared = await account.prepareTransaction({
 *   sourceChains: [base],
 *   targetChain: hyperCorePerp,
 *   tokenRequests: [{ address: usdc, amount: parseUnits('25', 6) }],
 *   hyperCore: {
 *     action: openPerp({ market, direction: 'long', notionalUsd: 100 }),
 *   },
 * })
 * const result = await account.submitTransaction(
 *   await account.signTransaction(prepared),
 * )
 * @see {@link closePerp}
 * @see {@link getPerpMarket}
 */
function openPerp(params: OpenPerpParams): HyperCoreOrderAction {
  const { market } = params
  const mark = markPrice(market)
  const size =
    params.size === undefined ? params.notionalUsd / mark : Number(params.size)
  return orderAction({
    market,
    mark,
    isBuy: params.direction === 'long',
    size,
    reduceOnly: false,
    slippageBps: params.slippageBps,
    ...(params.cloid ? { cloid: params.cloid } : {}),
  })
}

/**
 * Build a HyperCore action that closes a perpetual position.
 *
 * A reduce-only marketable IOC in the direction that flattens the position,
 * sized from the position itself. Closing frees margin rather than consuming
 * it, so it rides a transaction with no `tokenRequests` at all — but still
 * needs a `sourceChains` entry, since HyperCore is a delivery venue and hosts
 * no account of its own.
 *
 * @param params the market and the position to close
 * @returns the action to pass as `hyperCore.action` on a transaction
 * @throws {MismatchedPerpAssetError} if the market and position are different assets
 * @example
 * const market = await getPerpMarket('BTC')
 * const position = await getPerpPosition(account.getAddress(), 'BTC')
 * if (!position) return
 *
 * const prepared = await account.prepareTransaction({
 *   sourceChains: [hyperEvm],
 *   targetChain: hyperCorePerp,
 *   hyperCore: { action: closePerp({ market, position }) },
 * })
 * const result = await account.submitTransaction(
 *   await account.signTransaction(prepared),
 * )
 * @see {@link openPerp}
 * @see {@link getPerpPosition}
 */
function closePerp(params: ClosePerpParams): HyperCoreOrderAction {
  const { market, position } = params
  if (market.asset !== position.asset) {
    throw new MismatchedPerpAssetError(market.asset, position.asset)
  }
  const held = Number(position.size)
  const open = Math.abs(held)
  const size = params.size === undefined ? open : Number(params.size)
  if (size > open) {
    throw new HyperCoreError(
      `Cannot close ${size} ${market.asset} against an open position of ${open}. Hyperliquid rejects a reduce-only order larger than the position it reduces.`,
    )
  }
  return orderAction({
    market,
    mark: markPrice(market),
    // Flatten: sell a long, buy back a short.
    isBuy: held < 0,
    size,
    reduceOnly: true,
    slippageBps: params.slippageBps,
    ...(params.cloid ? { cloid: params.cloid } : {}),
  })
}

function orderAction(input: {
  market: PerpMarket
  mark: number
  isBuy: boolean
  size: number
  reduceOnly: boolean
  slippageBps?: number
  cloid?: Hex
}): HyperCoreOrderAction {
  const { market, mark, isBuy, reduceOnly } = input
  const slippageBps = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > 10_000
  ) {
    throw new HyperCoreError(
      `slippageBps must be a whole number of basis points between 0 and 10000, got ${input.slippageBps}.`,
    )
  }
  if (!Number.isFinite(input.size)) {
    throw new HyperCoreError(
      `Order size for ${market.asset} is not a number: ${input.size}.`,
    )
  }

  const limit =
    mark * (isBuy ? 1 + slippageBps / 10_000 : 1 - slippageBps / 10_000)
  const p = formatPerpPrice(limit, market.szDecimals, isBuy)
  const s = formatPerpSize(input.size, market.szDecimals)

  if (Number(s) <= 0) {
    throw new HyperCoreError(
      `An order size of ${input.size} rounds to zero at ${market.asset}'s ${market.szDecimals} decimals of size precision.`,
    )
  }
  // Reduce-only orders are exempt from the minimum on Hyperliquid's side, and
  // enforcing it here would leave a dust position with no way to close it.
  const notional = Number(s) * mark
  if (!reduceOnly && notional < MIN_ORDER_VALUE_USD) {
    throw new PerpOrderTooSmallError(
      market.asset,
      Math.round(notional * 100) / 100,
      MIN_ORDER_VALUE_USD,
    )
  }

  const order: HyperCoreOrder = {
    a: market.assetIndex,
    b: isBuy,
    p,
    s,
    r: reduceOnly,
    t: { limit: { tif: 'Ioc' } },
    ...(input.cloid ? { c: input.cloid } : {}),
  }
  return { type: 'order', orders: [order], grouping: 'na' }
}

function markPrice(market: PerpMarket): number {
  const mark = Number(market.markPx)
  if (!Number.isFinite(mark) || mark <= 0) {
    throw new HyperCoreError(
      `Hyperliquid reported no usable mark price for ${market.asset} (got ${JSON.stringify(market.markPx)}), so an order cannot be priced against it.`,
    )
  }
  return mark
}

/**
 * Round a price onto Hyperliquid's grid: at most 5 significant figures, and at
 * most `6 - szDecimals` decimals.
 *
 * Rounded in the direction that keeps the order marketable — up for a buy, down
 * for a sell — so the grid never eats the slippage it was given.
 */
function formatPerpPrice(
  price: number,
  szDecimals: number,
  roundUp: boolean,
): string {
  const decimals = Math.max(0, PERP_PRICE_DECIMAL_BUDGET - szDecimals)
  const significant = roundSignificant(
    price,
    MAX_PRICE_SIGNIFICANT_FIGURES,
    roundUp,
  )
  return trimDecimal(
    roundToGrid(significant, decimals, roundUp).toFixed(decimals),
  )
}

/** Round a size down onto the asset's size grid — never up past what was asked. */
function formatPerpSize(size: number, szDecimals: number): string {
  return trimDecimal(roundToGrid(size, szDecimals, false).toFixed(szDecimals))
}

function roundSignificant(
  value: number,
  digits: number,
  roundUp: boolean,
): number {
  if (value === 0) return 0
  const magnitude = Math.floor(Math.log10(Math.abs(value)))
  return roundToFactor(value, 10 ** (digits - 1 - magnitude), roundUp)
}

function roundToGrid(
  value: number,
  decimals: number,
  roundUp: boolean,
): number {
  return roundToFactor(value, 10 ** decimals, roundUp)
}

function roundToFactor(
  value: number,
  factor: number,
  roundUp: boolean,
): number {
  // Binary floats leave dust in the last ulp, and `ceil`/`floor` would turn it
  // into a whole extra tick. 15 digits is the widest a double carries exactly,
  // so it clears the dust without rounding away a digit the caller meant.
  const scaled = Number((value * factor).toPrecision(15))
  return (roundUp ? Math.ceil(scaled) : Math.floor(scaled)) / factor
}

/**
 * Hyperliquid normalises a decimal before encoding it, so `"1.50"` and `"1.5"`
 * are one price with two spellings. Emitting the normalised one keeps the
 * string a caller reads in the action identical to the one that gets hashed
 * into the agent authorising it.
 */
function trimDecimal(value: string): string {
  if (!value.includes('.')) return value
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '')
  return trimmed === '' || trimmed === '-' ? '0' : trimmed
}

export { closePerp, formatPerpPrice, formatPerpSize, openPerp }
export type { ClosePerpParams, OpenPerpParams, PerpOrderSize }
