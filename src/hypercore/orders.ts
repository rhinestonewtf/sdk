// Hyperliquid's order arithmetic, and nothing else. Pure: everything these need
// is an argument, and `resolve.ts` is what reads it from Hyperliquid.
//
// What they own is the part a caller should never have to reconstruct — the
// asset INDEX an order carries instead of a ticker, the tick and size grids a
// price and size must land on, and a limit priced far enough through the book to
// still cross when the intent delivers ~30s later.

import type { Hex } from 'viem'
import type {
  HyperCoreOrder,
  HyperCoreOrderAction,
} from '../clients/orchestrator/public'
import { HyperCoreError, PerpOrderTooSmallError } from './errors'
import type { PerpMarket, PerpPosition } from './market'
import type { ClosePerpRequest, OpenPerpRequest } from './types'

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

/**
 * A marketable IOC that opens a position: it fills against the book at up to
 * `slippageBps` through the mark and cancels the rest, which is how a market
 * order is expressed on Hyperliquid.
 */
function buildOpenPerpOrder(
  market: PerpMarket,
  request: OpenPerpRequest,
): HyperCoreOrderAction {
  const mark = markPrice(market)
  const size =
    request.size === undefined
      ? request.notionalUsd / mark
      : Number(request.size)
  return orderAction({
    market,
    mark,
    isBuy: request.direction === 'long',
    size,
    reduceOnly: false,
    slippageBps: request.slippageBps,
    ...(request.cloid ? { cloid: request.cloid } : {}),
  })
}

/**
 * A reduce-only marketable IOC in the direction that flattens the position,
 * sized from the position itself.
 */
function buildClosePerpOrder(
  market: PerpMarket,
  position: PerpPosition,
  request: ClosePerpRequest,
): HyperCoreOrderAction {
  const held = Number(position.size)
  const open = Math.abs(held)
  const size = request.size === undefined ? open : Number(request.size)
  if (size > open) {
    throw new HyperCoreError(
      `Cannot close ${size} ${request.asset} against an open position of ${open}. Hyperliquid rejects a reduce-only order larger than the position it reduces.`,
    )
  }
  return orderAction({
    market,
    mark: markPrice(market),
    // Flatten: sell a long, buy back a short.
    isBuy: held < 0,
    size,
    reduceOnly: true,
    slippageBps: request.slippageBps,
    ...(request.cloid ? { cloid: request.cloid } : {}),
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
      s,
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

export {
  buildClosePerpOrder,
  buildOpenPerpOrder,
  formatPerpPrice,
  formatPerpSize,
}
