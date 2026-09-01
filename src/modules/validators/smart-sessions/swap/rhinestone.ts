import { type Abi, type Address, type Hex, toFunctionSelector } from 'viem'
import { namedParamOffsets } from '../../permissions'
import type {
  RhinestoneSwapVenue,
  UniversalActionPolicyParamRule,
} from '../types'
import { FYND_CHAIN_IDS, FYND_ROUTERS, type FyndChainId } from './fynd'
import type { VenueContext, VenueScoping } from './rules'
import { cumulativeCap, pin, pinValue, pinWord, swapAction } from './rules'
import { ZEROX_ALLOWANCE_HOLDER, ZEROX_CHAIN_IDS } from './zero-ex'

/**
 * The Rhinestone Swapper — the route the orchestrator actually uses for
 * same-chain smart-account swaps, and the right layer to scope a session at.
 *
 * Scoping an aggregator directly (see `zero-ex.ts`, `fynd.ts`) describes a call
 * the account does not make on this route: the orchestrator wraps whichever
 * quoter wins behind its own Swapper, so a session scoped to 0x's
 * AllowanceHolder rejects its own intended swap with `InvalidSignature()`.
 * Verified live on Plasma — the account's sell token moves to the Swapper, and
 * the aggregator never appears in the account's ops.
 *
 * Scoping here is also strictly better:
 *   - aggregator-agnostic, so whichever quoter wins is irrelevant
 *   - no 0x Settler rotation problem, because this contract is ours
 *   - one approve target per chain (the proxy) instead of one per venue
 *   - the fields we care about are typed head args on a contract we control,
 *     with the aggregator route demoted to an opaque `calls[]` tail
 *
 * What the Swapper guarantees (verified in compact-utils/src/swapper):
 * at most `amountIn` of `tokenIn` is pulled, once, from `msg.sender`; the
 * recipient's measured balance delta must be >= `minAmountOut` or it reverts;
 * every refund and sweep goes to `msg.sender`. The account cannot be drained
 * beyond the pulled amount: the tail runs as the Swapper, which holds no
 * allowance from the account, and `SwapperLib.runRoute` forbids the tail from
 * calling the proxy that does.
 *
 * Be precise about what that bounds, though. A capped `amountIn` bounds how
 * much can LEAVE; it does not ensure anything comes back. `minAmountOut` is a
 * caller-supplied argument this scoping does not pin, and the contract accepts
 * zero — so with an unconstrained route a compromised key can spend up to the
 * cap and receive nothing. Naming a venue closes that by pinning the
 * route, leaving the pulled input nowhere to go but a real aggregator.
 */

/**
 * Both entrypoints share a head layout, which is what lets one venue cover
 * both: `tokenIn`@0, sell amount@32, `tokenOut`@64, `recipient`@160. The sell
 * amount is `amountIn` for exact-in and `amountInMax` for exact-out — in both
 * cases the ceiling on what leaves the account, which is exactly what to cap.
 */
export const swapperAbi = [
  {
    type: 'function',
    name: 'swapExactIn',
    stateMutability: 'payable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'tokenOut', type: 'address' },
      { name: 'minAmountOut', type: 'uint256' },
      { name: 'quotedAmountOut', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'orderRef', type: 'uint256' },
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'swapExactOut',
    stateMutability: 'payable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'amountInMax', type: 'uint256' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'quotedAmountIn', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'orderRef', type: 'uint256' },
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'amountSpent', type: 'uint256' }],
  },
] as const satisfies Abi

export const SWAP_EXACT_IN_SELECTOR = toFunctionSelector(swapperAbi[0])
export const SWAP_EXACT_OUT_SELECTOR = toFunctionSelector(swapperAbi[1])

const EXACT_IN = namedParamOffsets(swapperAbi as unknown as Abi, 'swapExactIn')
const EXACT_OUT = namedParamOffsets(
  swapperAbi as unknown as Abi,
  'swapExactOut',
)

/**
 * Deployed via CREATE2, so one address covers every chain. The proxy is
 * `new`'d in the Swapper's constructor and the binding is immutable both ways,
 * so a Swapper redeploy also changes the proxy — verify both together.
 *
 * Confirmed on Plasma: `Swapper.PROXY()` returns the proxy below.
 */
const SWAPPER_PRODUCTION: Address = '0x40CE38e0cbB8ec54a601256E4FacfED5679bccD0'
const PROXY_PRODUCTION: Address = '0x5afCe415B4370E5EfD8B9BE784d21C331bEAb965'
const SWAPPER_DEVELOPMENT: Address =
  '0x8206052a213AA7cafB18ec7898e8D1D421C02100'
const PROXY_DEVELOPMENT: Address = '0x21416a06e81fe115a5c8bf554b2b01383bd9b9f3'

export function swapperAddresses(environment: 'production' | 'development'): {
  swapper: Address
  proxy: Address
} {
  return environment === 'development'
    ? { swapper: SWAPPER_DEVELOPMENT, proxy: PROXY_DEVELOPMENT }
    : { swapper: SWAPPER_PRODUCTION, proxy: PROXY_PRODUCTION }
}

/**
 * Byte offsets of the `calls[]` ABI *shape* words, measured in the Swapper's
 * calldata past the selector. Identical for `swapExactIn` and `swapExactOut`
 * because both have the same eight-word head.
 *
 * Pinning a target inside a dynamic array is only sound if the layout is also
 * pinned: a compromised session key controls the encoding and could otherwise
 * relocate elements so a fixed offset reads an innocuous word. Pinning the array
 * pointer, the length, and each element pointer fixes every position, making the
 * target offsets exact.
 *
 * Derived from live Plasma calldata and reproduced by
 * `zeroExRouteRules` in the test suite:
 *   @224 array pointer  = 256   (tail begins right after the head)
 *   @256 length         = 2     (approve + aggregator call)
 *   @288 elem[0] pointer= 64    (element table is 2 words)
 *   @320 elem[1] pointer= 288   (64 + elem[0] size: 4 words + a 68-byte approve)
 *   @352 calls[0].target        (the sell-token approve)
 *   @576 calls[1].target        (the aggregator)
 *
 * `calls[1].data` — the variable-length aggregator blob — is LAST in the
 * encoding, so its length shifts nothing that is pinned. That is what makes
 * these offsets stable across quotes rather than coincidental.
 */
const CALLS_POINTER_OFFSET = 224n
const CALLS_LENGTH_OFFSET = 256n
const CALLS_ELEM0_POINTER_OFFSET = 288n
const CALLS_ELEM1_POINTER_OFFSET = 320n
const CALLS_ELEM0_TARGET_OFFSET = 352n
const CALLS_ELEM1_TARGET_OFFSET = 576n

const CALLS_ELEM0_VALUE_OFFSET = 384n
const CALLS_ELEM1_VALUE_OFFSET = 608n
const NESTED_EXEC_TOKEN_OFFSET = 740n
const CALLS_ELEM1_DATA_POINTER_OFFSET = 640n
/** Head words of the `AllowanceHolder.exec` nested in `calls[1].data`. */
const NESTED_EXEC_OPERATOR_OFFSET = 708n
const NESTED_EXEC_TARGET_OFFSET = 804n
const CALLS_ELEM1_DATA_POINTER = 96n

const CALLS_ELEM0_DATA_POINTER_OFFSET = 416n
const CALLS_ELEM0_DATA_LENGTH_OFFSET = 448n
/**
 * The word straddling `calls[0].data`'s selector and the high bytes of its
 * first argument. Pinning the spender alone leaves the selector free, so the
 * same word layout also satisfies `transfer(aggregator, amount)` — which sends
 * the pulled input to the aggregator instead of approving it, and with
 * `minAmountOut` free to be zero the Swapper does not object.
 */
const CALLS_ELEM0_DATA_HEAD_OFFSET = 480n
const ERC20_APPROVE_SELECTOR = '095ea7b3'

/** `approve` selector followed by the leading 28 bytes of the spender word. */
function approveHeadWord(spender: Address): Hex {
  return `0x${ERC20_APPROVE_SELECTOR}${'00'.repeat(12)}${spender
    .slice(2, 34)
    .toLowerCase()}` as Hex
}

/** The `spender` argument of `calls[0]`'s `approve`, past its 4-byte selector. */
const CALLS_ELEM0_SPENDER_OFFSET = 484n

const CALLS_ELEM0_DATA_POINTER = 96n
/** `approve(address,uint256)` — selector + two words. */
const APPROVE_CALLDATA_LENGTH = 68n

const CALLS_POINTER = 256n
const CALLS_LENGTH = 2n
const CALLS_ELEM0_POINTER = 64n
const CALLS_ELEM1_POINTER = 288n

/**
 * Pin the two-call `approve + aggregator` route inside the Swapper's `calls[]`.
 *
 * Without this the tail is unconstrained: the Swapper only requires that the
 * recipient nets `minAmountOut`, and `minAmountOut` may be zero, so a
 * compromised key could hand the pulled input to any address and satisfy the
 * contract. Constraining every call target to a real aggregator removes the
 * place those funds could go.
 *
 * Fails closed. A route that deviates from this shape — a different call count,
 * an added permit or approval reset — reverts rather than slipping through, so
 * the cost of the pin is availability, not safety.
 */
function routeRules(
  sellToken: Address,
  aggregator: Address,
  settler?: Address,
): UniversalActionPolicyParamRule[] {
  const nested: UniversalActionPolicyParamRule[] = settler
    ? [
        // Pinning calls[1]'s target to the AllowanceHolder still leaves the
        // exec it forwards free to name any operator and target, which is where
        // the pulled input would go. Pin those too when the Settler is known.
        pinValue(CALLS_ELEM1_VALUE_OFFSET, 0n),
        pinValue(CALLS_ELEM1_DATA_POINTER_OFFSET, CALLS_ELEM1_DATA_POINTER),
        pin(NESTED_EXEC_OPERATOR_OFFSET, settler),
        pin(NESTED_EXEC_TOKEN_OFFSET, sellToken),
        pin(NESTED_EXEC_TARGET_OFFSET, settler),
      ]
    : []
  return [
    ...nested,
    pinValue(CALLS_POINTER_OFFSET, CALLS_POINTER),
    pinValue(CALLS_LENGTH_OFFSET, CALLS_LENGTH),
    pinValue(CALLS_ELEM0_POINTER_OFFSET, CALLS_ELEM0_POINTER),
    pinValue(CALLS_ELEM1_POINTER_OFFSET, CALLS_ELEM1_POINTER),
    pin(CALLS_ELEM0_TARGET_OFFSET, sellToken),
    pin(CALLS_ELEM1_TARGET_OFFSET, aggregator),
    // Pinning calls[0]'s target alone still lets it be any call to the sell
    // token — `transfer(attacker, amountIn)` as easily as an approve. Fixing
    // its length and the address it names leaves the aggregator as the only
    // party the pulled input can reach.
    pinValue(CALLS_ELEM0_VALUE_OFFSET, 0n),
    pinValue(CALLS_ELEM0_DATA_POINTER_OFFSET, CALLS_ELEM0_DATA_POINTER),
    pinValue(CALLS_ELEM0_DATA_LENGTH_OFFSET, APPROVE_CALLDATA_LENGTH),
    pinWord(CALLS_ELEM0_DATA_HEAD_OFFSET, approveHeadWord(aggregator)),
    pin(CALLS_ELEM0_SPENDER_OFFSET, aggregator),
  ]
}

/**
 * Route swaps through the Rhinestone Swapper — the default, and the only venue
 * that matches what the orchestrator emits for same-chain smart-account swaps.
 *
 * Takes no addresses and no aggregator: which quoter fills the swap is the
 * orchestrator's decision, and this scoping holds whichever one wins.
 */
export function rhinestoneSwap(
  options: { maxSpend?: bigint } = {},
): RhinestoneSwapVenue {
  return {
    id: 'rhinestone',
    ...(options.maxSpend !== undefined ? { maxSpend: options.maxSpend } : {}),
  }
}
export function scopeRhinestone(
  venue: RhinestoneSwapVenue,
  ctx: VenueContext,
): VenueScoping {
  const { swapper, proxy } = swapperAddresses(ctx.environment)
  if (venue.route === 'zeroEx' && !ZEROX_CHAIN_IDS.includes(ctx.chainId as 1)) {
    throw new Error(
      `0x is not available on chain ${ctx.chainId}. ` +
        `Supported: ${ZEROX_CHAIN_IDS.join(', ')}.`,
    )
  }
  if (venue.route === 'fynd' && !FYND_CHAIN_IDS.includes(ctx.chainId as 1)) {
    throw new Error(
      `fynd is not available on chain ${ctx.chainId}. ` +
        `Supported: ${FYND_CHAIN_IDS.join(', ')}.`,
    )
  }
  // Which router the pinned tail must call. Undefined route = unconstrained.
  const routeAggregator =
    venue.route === 'zeroEx'
      ? ZEROX_ALLOWANCE_HOLDER
      : venue.route === 'fynd'
        ? FYND_ROUTERS[ctx.chainId as FyndChainId]
        : undefined

  const rulesFor = (
    offsets: Record<string, bigint>,
    sellAmountParam: string,
  ): UniversalActionPolicyParamRule[] => {
    const rules = [
      pin(offsets.tokenIn, ctx.sellToken),
      pin(offsets.tokenOut, ctx.buyToken),
      pin(offsets.recipient, ctx.recipient),
    ]
    if (ctx.cap !== undefined) {
      rules.push(cumulativeCap(offsets[sellAmountParam], ctx.cap))
    }
    if (routeAggregator !== undefined) {
      rules.push(
        ...routeRules(
          ctx.sellToken,
          routeAggregator,
          venue.route === 'zeroEx' ? venue.settler : undefined,
        ),
      )
    }
    return rules
  }

  return {
    // The account approves the proxy, never the Swapper and never a router —
    // one fixed spender per chain, whichever aggregator ends up filling.
    approveSpenders: [proxy],
    actions: [
      swapAction(
        swapper,
        SWAP_EXACT_IN_SELECTOR,
        rulesFor(EXACT_IN, 'amountIn'),
      ),
      swapAction(
        swapper,
        SWAP_EXACT_OUT_SELECTOR,
        rulesFor(EXACT_OUT, 'amountInMax'),
      ),
    ],
  }
}
