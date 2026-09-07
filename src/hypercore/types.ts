// The HyperCore surface of a transaction: what you want done on Hyperliquid,
// stated as data rather than built by hand.
//
// `openPerp` and `closePerp` are DECLARATIVE — `prepareTransaction` resolves
// them into a concrete action before it quotes, because that is when the action
// has to exist: the agent authorising it is derived from its bytes, and the
// signature covers a registration carrying that agent's address.

import type { Hex } from 'viem'
import type { HyperCoreAction } from '../clients/orchestrator/public'

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
       * transaction's `tokenRequests` deliver.
       */
      notionalUsd: number
      size?: never
    }
  | {
      /** Position size in units of the asset, e.g. `'0.0002'` BTC. */
      size: string
      notionalUsd?: never
    }

/** Open a perpetual position as part of this transaction. */
type OpenPerpRequest = PerpOrderSize & {
  /** Ticker as Hyperliquid names it — the coin alone, e.g. `BTC`. */
  asset: string
  direction: 'long' | 'short'
  /**
   * How far through the mark to place the limit, in basis points. Defaults to
   * 50 (0.5%).
   *
   * The price is fixed when the transaction is signed but the order is not
   * placed until the collateral has bridged, so this is the room the book is
   * allowed to move in between. Too tight and the order is refused with the
   * funds already on HyperCore.
   */
  slippageBps?: number
  /** Optional client order id — 128-bit hex — echoed back by the exchange. */
  cloid?: Hex
}

/** Close an open perpetual position as part of this transaction. */
interface ClosePerpRequest {
  /** Ticker as Hyperliquid names it — the coin alone, e.g. `BTC`. */
  asset: string
  /** Close only part of the position, in units of the asset. */
  size?: string
  /** How far through the mark to place the limit, in basis points. */
  slippageBps?: number
  /** Optional client order id — 128-bit hex — echoed back by the exchange. */
  cloid?: Hex
}

/**
 * What this transaction does on HyperCore. Exactly one of the three.
 *
 * `openPerp` and `closePerp` are resolved for you: the asset index, the price
 * and size grids, and the mark to price against are all read from Hyperliquid
 * while the transaction is prepared. `action` is the escape hatch — a
 * Hyperliquid L1 action passed through exactly as you wrote it, for the cases
 * the two above do not cover.
 *
 * An action that needs collateral (opening a position) must be paired with
 * `tokenRequests` that deliver it; one that does not (a close, a cancel, a
 * leverage change) rides a transaction that requests no tokens.
 *
 * One per transaction, whichever form: an agent authorises exactly one action,
 * and registering a second evicts the first.
 */
type HyperCoreOptions =
  | { openPerp: OpenPerpRequest; closePerp?: never; action?: never }
  | { closePerp: ClosePerpRequest; openPerp?: never; action?: never }
  | { action: HyperCoreAction; openPerp?: never; closePerp?: never }

export type {
  ClosePerpRequest,
  HyperCoreOptions,
  OpenPerpRequest,
  PerpOrderSize,
}
