import type { Address } from 'viem'
import type { SessionTokenInfo, SwapScopeInput } from '../types'

/**
 * Opt-in stable-swap floor (RHI-7883).
 *
 * The Swapper takes its output bound from the caller and its `calls[]` route
 * may call anything, so a capped input alone lets a session key set the bound
 * to zero and route the input away (RHI-7870). Pinning the output bound to a
 * floor derived from the cap bounds the rate: worst case floor/cap.
 */

const DEFAULT_MAX_SLIPPAGE_BPS = 100
const BPS = 10_000n
const USD_STABLE_SYMBOLS = new Set(['USDC', 'USDC.E', 'USDT', 'USDT0'])

export interface StableFloorParams {
  readonly maxSlippageBps: number
  readonly sellDecimals: number
  readonly buyDecimals: number
}

/** Validate a `stableFloor` scope; undefined when the scope does not opt in. */
export function resolveStableFloor(
  scope: SwapScopeInput,
  sellTokens: readonly Address[],
  supportedTokens: 'all' | readonly SessionTokenInfo[] | undefined,
): StableFloorParams | undefined {
  const option = scope.stableFloor
  if (option === undefined) return undefined

  const maxSlippageBps =
    option === true ? DEFAULT_MAX_SLIPPAGE_BPS : option.maxSlippageBps
  if (
    !Number.isInteger(maxSlippageBps) ||
    maxSlippageBps < 0 ||
    maxSlippageBps >= 10_000
  ) {
    throw new Error(
      `swap.stableFloor.maxSlippageBps must be an integer in [0, 10000), got ${maxSlippageBps}`,
    )
  }
  if (sellTokens.length !== 1) {
    throw new Error(
      'swap.stableFloor needs exactly one sell token — the floor is derived ' +
        'from one token’s cap and decimals',
    )
  }
  if (scope.sell.maxTotal === undefined) {
    throw new Error(
      'swap.stableFloor needs swap.sell.maxTotal — the floor is a fraction of it',
    )
  }
  const nonSwapper = (scope.via ?? []).find(
    (venue) => venue.id !== 'rhinestone',
  )
  if (nonSwapper) {
    throw new Error(
      `swap.stableFloor allows only the Rhinestone Swapper venue, not ${nonSwapper.id}: ` +
        'a direct aggregator call has no output bound for the floor to pin',
    )
  }
  if (supportedTokens === undefined) {
    throw new Error(
      'swap.stableFloor needs the chain’s token catalog to confirm both tokens ' +
        'are USD stablecoins — build with sdk.createSession, or pass ' +
        'supportedTokens to toSession',
    )
  }
  if (supportedTokens === 'all') {
    throw new Error(
      'swap.stableFloor cannot confirm stablecoins on this chain: its catalog ' +
        'lists all tokens rather than their symbols and decimals',
    )
  }
  const stable = (token: Address, side: 'sell' | 'buy'): SessionTokenInfo => {
    const info = supportedTokens.find(
      (t) => t.address.toLowerCase() === token.toLowerCase(),
    )
    if (!info) {
      throw new Error(
        `swap.stableFloor: ${side} token ${token} is not in the chain’s token catalog`,
      )
    }
    if (!USD_STABLE_SYMBOLS.has(info.symbol.toUpperCase())) {
      throw new Error(
        `swap.stableFloor: ${side} token ${token} (${info.symbol}) is not a USD ` +
          `stablecoin — supported: ${[...USD_STABLE_SYMBOLS].join(', ')}`,
      )
    }
    return info
  }
  return {
    maxSlippageBps,
    sellDecimals: stable(sellTokens[0], 'sell').decimals,
    buyDecimals: stable(scope.buy.token, 'buy').decimals,
  }
}

/**
 * The minimum buy-token output for a swap of up to `cap` sell tokens, rounded
 * up so the floor never admits a rate below the tolerance.
 */
export function stableFloorAmount(
  cap: bigint,
  params: StableFloorParams,
): bigint {
  const numerator =
    cap *
    (BPS - BigInt(params.maxSlippageBps)) *
    10n ** BigInt(params.buyDecimals)
  const denominator = BPS * 10n ** BigInt(params.sellDecimals)
  return (numerator + denominator - 1n) / denominator
}
