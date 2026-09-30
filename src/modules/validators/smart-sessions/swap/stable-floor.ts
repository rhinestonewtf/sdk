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
const STABLE_DECIMALS = new Set([6, 18])

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
        'are USD stablecoins — create the session with sdk.createSession',
    )
  }
  if (supportedTokens === 'all') {
    throw new Error(
      'swap.stableFloor cannot confirm stablecoins on this chain: its catalog ' +
        'lists all tokens rather than their symbols and decimals',
    )
  }
  const stable = (token: Address, side: 'sell' | 'buy'): SessionTokenInfo => {
    const matches = supportedTokens.filter(
      (t) => t.address.toLowerCase() === token.toLowerCase(),
    )
    if (matches.length === 0) {
      throw new Error(
        `swap.stableFloor: ${side} token ${token} is not in the chain’s token catalog`,
      )
    }
    // Two entries could disagree on decimals, and the floor would silently
    // take whichever came first.
    if (matches.length > 1) {
      throw new Error(
        `swap.stableFloor: ${side} token ${token} appears ${matches.length} times in the chain’s token catalog`,
      )
    }
    const info = matches[0]
    if (!USD_STABLE_SYMBOLS.has(info.symbol.toUpperCase())) {
      throw new Error(
        `swap.stableFloor: ${side} token ${token} (${info.symbol}) is not a USD ` +
          `stablecoin — supported: ${[...USD_STABLE_SYMBOLS].join(', ')}`,
      )
    }
    // Every USD stable the catalog lists is 6 or 18; anything else is a bad
    // entry, and a wrong scale moves the floor by orders of magnitude.
    if (!STABLE_DECIMALS.has(info.decimals)) {
      throw new Error(
        `swap.stableFloor: ${side} token ${token} (${info.symbol}) has ${info.decimals} decimals in the catalog; expected 6 or 18`,
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

const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

/**
 * Refuse a stableFloor session that grants a way to move the sell token around
 * the floor: a user action on the sell token, Permit2 or the Swapper, or an
 * ERC-1271 signing surface (the key could sign a Permit2 transfer no calldata
 * pin ever sees).
 */
export function assertStableFloorIsolated(input: {
  readonly sellToken: Address
  readonly swapper: Address
  readonly userTargets: readonly Address[]
  readonly signingMode: 'disabled' | 'unrestricted' | 'scoped' | undefined
}): void {
  if (input.signingMode !== undefined && input.signingMode !== 'disabled') {
    throw new Error(
      'swap.stableFloor cannot enable `signing`: an ERC-1271 signature could ' +
        'move the sell token without meeting the floor',
    )
  }
  const guarded = [input.sellToken, PERMIT2, input.swapper].map((a) =>
    a.toLowerCase(),
  )
  const sideDoor = input.userTargets.find((t) =>
    guarded.includes(t.toLowerCase()),
  )
  if (sideDoor) {
    throw new Error(
      `swap.stableFloor: the session also grants an action on ${sideDoor}, ` +
        'which could move the sell token without meeting the floor',
    )
  }
}
