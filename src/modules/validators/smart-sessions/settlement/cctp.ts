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
 * EVM chains CCTP routes between: the chain's domain and its native USDC, the
 * only token CCTP burns or mints. Domains are network-neutral (Base and Base
 * Sepolia are both 6). Solana (domain 5) is left out: its `mintRecipient` is
 * the recipient's ATA and the wallet sits in the dynamic `hookData`.
 */
export const CCTP_CHAINS: Readonly<
  Record<number, { readonly domain: number; readonly usdc: Address }>
> = {
  1: { domain: 0, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  10: { domain: 2, usdc: '0x0b2c639c533813f4aa9d7837caf62653d097ff85' },
  130: { domain: 10, usdc: '0x078d782b760474a361dda0af3839290b0ef57ad6' },
  137: { domain: 7, usdc: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359' },
  143: { domain: 15, usdc: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' },
  146: { domain: 13, usdc: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894' },
  999: { domain: 19, usdc: '0xb88339CB7199b77E23DB6E890353E22632Ba630f' },
  5042: { domain: 26, usdc: '0x3600000000000000000000000000000000000000' },
  8453: { domain: 6, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  42161: { domain: 3, usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
  43114: { domain: 1, usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' },
  57073: { domain: 21, usdc: '0x2d270e6886d130d724215a266106e6832161eaed' },
  84532: { domain: 6, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
  421614: { domain: 3, usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' },
  11155111: { domain: 0, usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
  11155420: { domain: 2, usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7' },
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

function cctpChain(chainId: number) {
  const chain = CCTP_CHAINS[chainId]
  if (chain === undefined) {
    throw new Error(
      `crossChainPermits: CCTP does not route to chain ${chainId}`,
    )
  }
  return chain
}

/** CCTP moves only native USDC, so any other token names a route it cannot take. */
function requireUsdc(chainId: number, token: Address, leg: 'from' | 'to') {
  if (!isAddressEqual(token, cctpChain(chainId).usdc)) {
    throw new Error(
      `crossChainPermits: CCTP moves only USDC; the \`${leg}\` token on chain ${chainId} is ${token}`,
    )
  }
}

export function cctpTokenMessenger(chainId: number): Address {
  cctpChain(chainId)
  return TOKEN_MESSENGER[
    CCTP_TESTNET_CHAIN_IDS.has(chainId) ? 'testnet' : 'mainnet'
  ]
}

/** The burn call, pinned to the permit's token, destinations and cap. */
export function scopeCctp(ctx: SettlementContext): ScopedAction {
  if (ctx.sourceTokens.length !== 1) {
    throw new Error(
      'crossChainPermits: CCTP burns one token (USDC) per chain; give exactly one `from` token on this chain',
    )
  }
  requireUsdc(ctx.chainId, ctx.sourceTokens[0], 'from')
  const rules: UniversalActionPolicyParamRule[] = [
    pin(BURN.burnToken, ctx.sourceTokens[0]),
    // A non-zero destinationCaller restricts who may mint; the orchestrator
    // never sets one, so any other value is not a settlement it built.
    pinValue(BURN.destinationCaller, 0n),
  ]
  if (ctx.cap !== undefined) rules.push(cumulativeCap(BURN.amount, ctx.cap))
  const legs = ctx.destinations.map((leg) => {
    requireUsdc(leg.chainId, leg.token, 'to')
    const legRules = [
      pinValue(BURN.destinationDomain, BigInt(cctpChain(leg.chainId).domain)),
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
