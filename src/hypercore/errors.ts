/**
 * Thrown by the HyperCore helpers — building an action or reading Hyperliquid's
 * public info endpoint. Kept distinct from `OrchestratorError` so a bad order
 * is catchable separately from a failed quote.
 */
export class HyperCoreError extends Error {}

export function isHyperCoreError(error: unknown): error is HyperCoreError {
  return error instanceof HyperCoreError
}

/** The ticker is not in Hyperliquid's perp universe. */
export class UnknownPerpAssetError extends HyperCoreError {
  readonly asset: string

  constructor(asset: string) {
    super(
      `No Hyperliquid perp market named "${asset}". Tickers are the coin alone (\`BTC\`, not \`BTC-PERP\`); list them with \`getPerpMarkets()\`.`,
    )
    this.asset = asset
  }
}

/**
 * The order is below Hyperliquid's minimum order value. Raised here rather than
 * left to the exchange because an intent that delivers collateral is refused
 * only after the funds have landed on HyperCore.
 */
export class PerpOrderTooSmallError extends HyperCoreError {
  readonly size: string
  readonly notionalUsd: number
  readonly minimumUsd: number

  constructor(
    asset: string,
    size: string,
    notionalUsd: number,
    minimumUsd: number,
  ) {
    super(
      `A ${asset} order of ${size} is worth $${notionalUsd}, below Hyperliquid's $${minimumUsd} minimum order value. Ask for more: a size is floored to the asset's precision, so a request only just over the minimum can land under it.`,
    )
    this.size = size
    this.notionalUsd = notionalUsd
    this.minimumUsd = minimumUsd
  }
}

/** `closePerp` was given a market and a position for different assets. */
export class MismatchedPerpAssetError extends HyperCoreError {
  readonly marketAsset: string
  readonly positionAsset: string

  constructor(marketAsset: string, positionAsset: string) {
    super(
      `Cannot close a ${positionAsset} position against the ${marketAsset} market. Pass the market for the position's own asset — an order carries the market's asset index, so a mismatch trades the wrong coin.`,
    )
    this.marketAsset = marketAsset
    this.positionAsset = positionAsset
  }
}

/** Hyperliquid's info endpoint answered with a non-2xx status. */
export class HyperCoreInfoRequestError extends HyperCoreError {
  readonly status: number
  readonly url: string

  constructor(url: string, status: number, body: string) {
    super(
      `Hyperliquid info request to ${url} failed with status ${status}${body ? `: ${body.slice(0, 200)}` : ''}`,
    )
    this.status = status
    this.url = url
  }
}
