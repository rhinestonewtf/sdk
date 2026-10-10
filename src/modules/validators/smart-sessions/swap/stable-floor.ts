import type { Address } from 'viem'
import type { ServedStablecoin, SwapScopeInput } from '../types'
import { floorFor } from './rules'

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
/** The decimals a served USD stablecoin may have; any other is a bad entry. */
export const STABLE_DECIMALS = new Set([6, 18])

export interface StableFloorParams {
  readonly maxSlippageBps: number
  readonly sellDecimals: number
  readonly buyDecimals: number
}

/** Validate a `stableFloor` scope; undefined when the scope does not opt in. */
export function resolveStableFloor(
  scope: SwapScopeInput,
  sellTokens: readonly Address[],
  stablecoins: readonly ServedStablecoin[] | undefined,
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
        "from one token's cap and decimals",
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
  if (stablecoins === undefined) {
    throw new Error(
      "swap.stableFloor needs the orchestrator's stablecoins for this chain; create the session with sdk.createSession",
    )
  }
  const stable = (token: Address, side: 'sell' | 'buy'): ServedStablecoin => {
    const matches = stablecoins.filter(
      (t) => t.address.toLowerCase() === token.toLowerCase(),
    )
    if (matches.length === 0) {
      throw new Error(
        `swap.stableFloor: ${side} token ${token} is not a USD stablecoin the orchestrator serves for this chain`,
      )
    }
    // Two entries could disagree on decimals, and the floor would silently
    // take whichever came first.
    if (matches.length > 1) {
      throw new Error(
        `swap.stableFloor: ${side} token ${token} appears ${matches.length} times in the served stablecoins`,
      )
    }
    const info = matches[0]
    // Every served USD stable is 6 or 18; anything else is a bad entry, and a
    // wrong scale moves the floor by orders of magnitude.
    if (!STABLE_DECIMALS.has(info.decimals)) {
      throw new Error(
        `swap.stableFloor: ${side} token ${token} (${info.symbol}) has ${info.decimals} decimals; expected 6 or 18`,
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
 * up so the floor never admits a rate below the tolerance. Exact-in bounds the
 * output (`out >= in × (1 − bps)`), exact-out the input (`in <= out × (1 + bps)`,
 * so `out >= in ÷ (1 + bps)`): at 100 bps the two floors differ by 1 bp of the
 * cap, and far more at higher tolerances.
 */
export function stableFloorAmount(
  cap: bigint,
  params: StableFloorParams,
  direction: 'exactIn' | 'exactOut',
): bigint {
  const bps = BigInt(params.maxSlippageBps)
  const [rateNumerator, rateDenominator] =
    direction === 'exactIn' ? [BPS - bps, BPS] : [BPS, BPS + bps]
  return floorFor(
    cap,
    rateNumerator,
    rateDenominator,
    params.sellDecimals,
    params.buyDecimals,
  )
}

export const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

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
  readonly hasCrossChainGrants: boolean
}): void {
  // A permit or claim policy compiles to its own actions (a SAME_CHAIN_IE permit
  // is a `transfer` on the source token), which the target check below never sees.
  if (input.hasCrossChainGrants) {
    throw new Error(
      'swap.stableFloor cannot be combined with `crossChainPermits` or ' +
        '`claimPolicies`: their actions could move the sell token without ' +
        'meeting the floor',
    )
  }
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
