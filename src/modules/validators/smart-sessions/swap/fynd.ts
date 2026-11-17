import { type Abi, type Address, toFunctionSelector } from 'viem'
import { namedParamOffsets } from '../../permissions'
import type { FyndVenue, UniversalActionPolicyParamRule } from '../types'
import type { VenueContext, VenueScoping } from './rules'
import {
  cumulativeCap,
  pin,
  sellPinsGoInAlternatives,
  swapAction,
} from './rules'

/**
 * fynd — Rhinestone's self-hosted Tycho aggregator.
 *
 * Unlike 0x there is no allowance-holder indirection: the TychoRouter is both
 * the swap target and the ERC-20 approval spender, and every field we care about
 * is a named static argument in the calldata head. That means nothing here is a
 * magic offset — the rules are addressed by ABI parameter name.
 */

/** Chains with a deployed, whitelisted TychoRouter. */
export const FYND_CHAIN_IDS = [1, 56, 130, 137, 8453, 9745, 42161] as const

export type FyndChainId = (typeof FYND_CHAIN_IDS)[number]

/**
 * TychoRouter V3 per chain — the contract fynd's encoded fills target.
 *
 * Mirrors the first router of each chain's `fynd.routers` in yeet's
 * `config/quoters.jsonnet`. A chain is listed only when the router is
 * whitelisted in `IntentExecutionPolicy`, since a quoter enabled without a
 * whitelisted target produces quotes that revert.
 */
export const FYND_ROUTERS: Record<FyndChainId, Address> = {
  1: '0xe41c726421007e133a59365432fe886a73b45126',
  56: '0xee7ece626064bda1c6afdb8a281afe44eabd3242',
  130: '0x556dff14e4a42259ebce4fa087323c1047e9a55a',
  137: '0x4db0b661dc706f7e09e54273028b22f61f8f94c2',
  8453: '0xd374c00614f95492d816b5957e3797ce3f0c445c',
  9745: '0x43c747a86e84ce280c4c41909e6e4a5adc3a0bef',
  42161: '0x1b82e8c16ce8e17535c9b6b8ad107f61b0b192b5',
}

/**
 * TychoRouterV3 `singleSwap`, the entrypoint fynd's encoded quotes call.
 *
 * Names are upstream's (`TychoRouterV3.sol` and its `ClientFeeParams` struct,
 * propeller-heads/tycho at tag 0.387.0); the types are pinned by
 * {@link FYND_SWAP_SELECTOR}'s assertion in the test suite. We never address
 * `clientFeeParams`: a tuple containing `bytes` is dynamic and sits behind a
 * pointer.
 */
export const tychoRouterAbi = [
  {
    type: 'function',
    name: 'singleSwap',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'expectedAmountOut', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      {
        name: 'clientFeeParams',
        type: 'tuple',
        components: [
          { name: 'clientFeeBps', type: 'uint32' },
          { name: 'clientFeeReceiver', type: 'address' },
          { name: 'maxClientContribution', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'clientSignature', type: 'bytes' },
        ],
      },
      { name: 'swapData', type: 'bytes' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const satisfies Abi

export const FYND_SWAP_SELECTOR = toFunctionSelector(tychoRouterAbi[0])

/** Head offsets derived from the ABI — never hardcoded. */
const OFFSETS = namedParamOffsets(
  tychoRouterAbi as unknown as Abi,
  'singleSwap',
)

/**
 * Scope a session to fynd swaps.
 *
 * Needs no addresses: the router is a per-chain deployment the SDK knows, and
 * because it is also the approval spender there is no separate allowance target
 * to reason about.
 */
export function fynd(options: { maxSpend?: bigint } = {}): FyndVenue {
  return {
    id: 'fynd',
    ...(options.maxSpend !== undefined ? { maxSpend: options.maxSpend } : {}),
  }
}

export function scopeFynd(ctx: VenueContext): VenueScoping {
  const router = FYND_ROUTERS[ctx.chainId as FyndChainId]
  if (router === undefined) {
    throw new Error(
      `fynd is not available on chain ${ctx.chainId}. ` +
        `Supported: ${FYND_CHAIN_IDS.join(', ')}.`,
    )
  }
  const multiSell = sellPinsGoInAlternatives(ctx)
  const rules: UniversalActionPolicyParamRule[] = [
    // One token keeps its pin here, which is what preserves the historical
    // rule order, policy type and digest.
    ...(multiSell ? [] : [pin(OFFSETS.tokenIn, ctx.sellTokens[0])]),
    pin(OFFSETS.tokenOut, ctx.buyToken),
    pin(OFFSETS.receiver, ctx.recipient),
  ]
  if (ctx.cap !== undefined) {
    rules.push(cumulativeCap(OFFSETS.amountIn, ctx.cap))
  }
  // Several tokens become an OR over the one word that differs between them.
  const sellAlternatives = multiSell
    ? ctx.sellTokens.map((token) => [pin(OFFSETS.tokenIn, token)])
    : []
  return {
    approveSpenders: [router],
    actions: [swapAction(router, FYND_SWAP_SELECTOR, rules, sellAlternatives)],
  }
}
