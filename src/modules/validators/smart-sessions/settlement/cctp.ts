import {
  type Abi,
  type Address,
  isAddressEqual,
  pad,
  toFunctionSelector,
} from 'viem'
import { namedParamOffsets } from '../../permissions'
import {
  cumulativeCap,
  pin,
  pinValue,
  pinWord,
  swapAction,
} from '../swap/rules'
import type { ScopedAction, UniversalActionPolicyParamRule } from '../types'
import { SettlementLayerRefusal, served } from './served'
import type { SettlementCatalog, SettlementContext } from './types'

/**
 * CCTP V2 — `TokenMessengerV2.depositForBurnWithHook`, encoded by the
 * orchestrator against a fixed Circle deployment, so every field the session
 * pins is a static head word.
 */

export const tokenMessengerAbi = [
  {
    type: 'function',
    name: 'depositForBurnWithHook',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [],
  },
] as const satisfies Abi

export const DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR = toFunctionSelector(
  tokenMessengerAbi[0],
)

const BURN = namedParamOffsets(
  tokenMessengerAbi as unknown as Abi,
  'depositForBurnWithHook',
)

/**
 * CCTP moves only native USDC, so any other token names a route it cannot take.
 * Solana (domain 5) is never served: its `mintRecipient` is the recipient's ATA.
 */
function requireUsdc(
  settlement: SettlementCatalog,
  chainId: number,
  token: Address,
  leg: 'from' | 'to',
) {
  if (!isAddressEqual(token, served(settlement, chainId, 'cctp').usdc)) {
    throw new SettlementLayerRefusal(
      `crossChainPermits: CCTP moves only USDC; the \`${leg}\` token on chain ${chainId} is ${token}`,
      { code: 'TOKEN_NOT_ROUTED', chainId, leg },
    )
  }
}

/** The burn call, pinned to the permit's token, destinations and cap. */
export function scopeCctp(ctx: SettlementContext): ScopedAction {
  if (ctx.sourceTokens.length !== 1) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: CCTP burns one token (USDC) per chain; give exactly one `from` token on this chain',
      { code: 'ONE_SOURCE_TOKEN', chainId: ctx.chainId },
    )
  }
  requireUsdc(ctx.settlement, ctx.chainId, ctx.sourceTokens[0], 'from')
  const rules: UniversalActionPolicyParamRule[] = [
    pin(BURN.burnToken, ctx.sourceTokens[0]),
    // A non-zero destinationCaller restricts who may mint; the orchestrator
    // never sets one, so any other value is not a settlement it built.
    pinValue(BURN.destinationCaller, 0n),
  ]
  if (ctx.cap !== undefined) rules.push(cumulativeCap(BURN.amount, ctx.cap))
  const legs = ctx.destinations.map((leg) => {
    requireUsdc(ctx.settlement, leg.chainId, leg.token, 'to')
    const legRules = [
      pinValue(
        BURN.destinationDomain,
        BigInt(served(ctx.settlement, leg.chainId, 'cctp').domain),
      ),
    ]
    if (leg.recipient !== undefined) {
      legRules.push(pinWord(BURN.mintRecipient, pad(leg.recipient)))
    }
    return legRules
  })
  // One destination keeps its pins in the shared AND; several become an OR of
  // (domain, recipient) pairs so a recipient is only valid on its own chain.
  const action =
    legs.length === 1
      ? swapAction(ctx.target, DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR, [
          ...rules,
          ...legs[0],
        ])
      : swapAction(ctx.target, DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR, rules, legs)
  return { ...action, policies: [...(action.policies ?? []), ...ctx.timeFrame] }
}
