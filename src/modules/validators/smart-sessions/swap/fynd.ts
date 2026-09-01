import { type Abi, type Address, toFunctionSelector } from 'viem'
import { namedParamOffsets } from '../../permissions'
import type { FyndVenue, UniversalActionPolicyParamRule } from '../types'
import type { VenueContext, VenueScoping } from './rules'
import { cumulativeCap, pin, swapAction } from './rules'

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
 * TychoRouter per chain — the contract fynd's encoded fills target.
 *
 * Mirrors `fynd.routers` in the orchestrator's quoters.jsonnet. A chain is
 * listed only when the router is whitelisted in `IntentExecutionPolicy`, since a
 * quoter enabled without a whitelisted target produces quotes that revert.
 */
const FYND_ROUTERS: Record<FyndChainId, Address> = {
  1: '0xda892c989d07a18b5dd3f392d949f00df15c5736',
  56: '0x99748cbd931cb367dad265c5b2b4bd306d448e99',
  130: '0x764bc67b1036b00bc91221e988261f971a1c7ce4',
  137: '0x7cb3e87095f6cf95982dc6f57445171a6d3b511c',
  8453: '0x2d3524b9b5dae34b646614eebb1e038d403e4cac',
  9745: '0x8f9b3b0451efff0ae8100428aee35fa3cbc0b769',
  42161: '0xc1f838a5382bbb5729a0801c8ba73dfc861c4d34',
}

/**
 * TychoRouter `singleSwap`, the entrypoint fynd's encoded quotes call.
 *
 * Only the argument TYPES determine the selector and the head layout, and those
 * are pinned by {@link FYND_SWAP_SELECTOR}'s assertion in the test suite. The
 * NAMES of the first five are corroborated by observed fynd calldata; the
 * trailing tuple's component names are our own labels and carry no guarantee —
 * we never address them, since a tuple containing `bytes` is dynamic and sits
 * behind a pointer.
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
      { name: 'minAmountOut', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      {
        name: 'permit',
        type: 'tuple',
        components: [
          { name: 'nonce', type: 'uint16' },
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      { name: 'swap', type: 'bytes' },
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
  const rules: UniversalActionPolicyParamRule[] = [
    pin(OFFSETS.tokenIn, ctx.sellToken),
    pin(OFFSETS.tokenOut, ctx.buyToken),
    pin(OFFSETS.receiver, ctx.recipient),
  ]
  if (ctx.cap !== undefined) {
    rules.push(cumulativeCap(OFFSETS.amountIn, ctx.cap))
  }
  return {
    approveSpenders: [router],
    actions: [swapAction(router, FYND_SWAP_SELECTOR, rules)],
  }
}
