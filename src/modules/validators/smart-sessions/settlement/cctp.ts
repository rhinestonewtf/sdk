import { type Abi, type Address, pad, toFunctionSelector } from 'viem'
import { namedParamOffsets } from '../../permissions'
import {
  cumulativeCap,
  pin,
  pinValue,
  pinWord,
  swapAction,
} from '../swap/rules'
import type { ScopedAction, UniversalActionPolicyParamRule } from '../types'
import type { SettlementContext } from './types'

/**
 * CCTP V2 — `TokenMessengerV2.depositForBurnWithHook`, encoded by the
 * orchestrator against a fixed Circle deployment, so every field the session
 * pins is a static head word.
 */

/** Circle deploys TokenMessengerV2 at one address per network class. */
const TOKEN_MESSENGER: Record<'mainnet' | 'testnet', Address> = {
  mainnet: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
  testnet: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
}

/**
 * EVM chain id → CCTP domain. Domains are network-neutral (Base and Base
 * Sepolia are both 6). Solana (domain 5) is left out: its `mintRecipient` is
 * the recipient's ATA and the wallet sits in the dynamic `hookData`.
 */
export const CCTP_DOMAINS: Readonly<Record<number, number>> = {
  1: 0,
  10: 2,
  130: 10,
  137: 7,
  143: 15,
  146: 13,
  999: 19,
  5042: 26,
  8453: 6,
  42161: 3,
  43114: 1,
  57073: 21,
  84532: 6,
  421614: 3,
  11155111: 0,
  11155420: 2,
}

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

/** Keyed by chain id rather than `chain.testnet`, which a custom chain may omit. */
const CCTP_TESTNET_CHAIN_IDS: ReadonlySet<number> = new Set([
  84532, 421614, 11155111, 11155420,
])

export function cctpTokenMessenger(chainId: number): Address {
  cctpDomain(chainId)
  return TOKEN_MESSENGER[
    CCTP_TESTNET_CHAIN_IDS.has(chainId) ? 'testnet' : 'mainnet'
  ]
}

export function cctpDomain(chainId: number): number {
  const domain = CCTP_DOMAINS[chainId]
  if (domain === undefined) {
    throw new Error(
      `crossChainPermits: CCTP does not route to chain ${chainId}`,
    )
  }
  return domain
}

/** The burn call, pinned to the permit's token, destinations and cap. */
export function scopeCctp(ctx: SettlementContext): ScopedAction {
  cctpDomain(ctx.chainId)
  if (ctx.sourceTokens.length !== 1) {
    throw new Error(
      'crossChainPermits: CCTP burns one token (USDC) per chain; give exactly one `from` token on this chain',
    )
  }
  const rules: UniversalActionPolicyParamRule[] = [
    pin(BURN.burnToken, ctx.sourceTokens[0]),
    // A non-zero destinationCaller restricts who may mint; the orchestrator
    // never sets one, so any other value is not a settlement it built.
    pinValue(BURN.destinationCaller, 0n),
  ]
  if (ctx.cap !== undefined) rules.push(cumulativeCap(BURN.amount, ctx.cap))
  const legs = ctx.destinations.map((leg) => {
    const legRules: UniversalActionPolicyParamRule[] = []
    if (leg.chainId !== undefined) {
      legRules.push(
        pinValue(BURN.destinationDomain, BigInt(cctpDomain(leg.chainId))),
      )
    }
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
