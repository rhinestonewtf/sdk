import {
  type Address,
  concat,
  type Hex,
  isAddressEqual,
  pad,
  parseAbi,
  slice,
  toFunctionSelector,
} from 'viem'
import { cumulativeCap, pin, pinValue, pinWord } from '../swap/rules'
import type {
  ArgPolicyExpression,
  ScopedAction,
  UniversalActionPolicyParamRule,
} from '../types'
import type { SettlementContext } from './types'

/**
 * ECO — Eco Routes, `Portal.publishAndFund` with Eco's quoted route bytes
 * forwarded verbatim by the orchestrator.
 *
 * The recipient lives inside the vendor route, and the reward's offsets move
 * with the route's length, so the session pins the one shape the orchestrator
 * accepts end to end: an ERC-20 reward and a single `transfer` delivery.
 * Every pointer and length word is pinned so no field can alias another.
 */

/** Eco deploys its Portal at one CREATE2 address on every mainnet. */
export const ECO_PORTAL: Address = '0xEC000064576f9C95a8623Bc0eff3db6d296ea6df'

/**
 * Eco's provers and the chains each is deployed on, checked on-chain (code
 * present, `PORTAL()` is the Portal). An unlisted prover could attest a fill
 * that never happened; a listed one with no code on the source chain makes
 * `refund` revert and locks the reward, so a leg may only name a prover that
 * exists on both of its chains.
 */
export const ECO_PROVERS: Readonly<Record<Address, readonly number[]>> = {
  // HyperProver
  '0xec004Ab4870c4e177c66949329dCdb503CE41022': [
    1, 10, 130, 137, 999, 8453, 9745, 42161,
  ],
  // CCIPProver
  '0xceBB7cDDBA4734C7130BF114a37C2dA4C5f3c473': [1, 2020, 8453],
  // PolymerProver
  '0xE3e4e6F284f1c8E17bafE4268EB98c36886B4d8B': [1, 10, 137, 8453, 42161],
}

/**
 * USD stablecoins per chain Eco routes between, all 6 decimals. The delivery
 * floor compares reward and delivery in raw units 1:1, which only holds
 * between USD stablecoins of equal decimals.
 */
export const ECO_STABLECOINS: Readonly<Record<number, readonly Address[]>> = {
  1: [
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    '0xdac17f958d2ee523a2206206994597c13d831ec7',
  ],
  10: [
    '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
    '0x01bFF41798a0BcF287b996046Ca68b395DbC1071',
    '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
  ],
  130: [
    '0x078d782b760474a361dda0af3839290b0ef57ad6',
    '0x9151434b16b9763660705744891fA906F660EcC5',
  ],
  137: [
    '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
  ],
  999: [
    '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
    '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
  ],
  2020: ['0x0b7007c13325c48911f73a2dad5fa5dcbf808adc'],
  8453: ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'],
  9745: [
    '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
    '0x2d661C89D812261039AF9764eceaAee884f5F67F',
  ],
  42161: [
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
  ],
}

export const ecoPortalAbi = parseAbi([
  'function publishAndFund(uint64 destination, bytes route, (uint64 deadline,address creator,address prover,uint256 nativeAmount,(address token,uint256 amount)[] tokens) reward, bool allowPartial) payable returns (bytes32 intentHash, address vault)',
])

export const PUBLISH_AND_FUND_SELECTOR = toFunctionSelector(ecoPortalAbi[0])

const TRANSFER_SELECTOR = toFunctionSelector('transfer(address,uint256)')

/**
 * Offsets from the start of `publishAndFund`'s args for the canonical encoding
 * of an ERC-20 reward and a route that delivers one token by one `transfer`.
 */
export const PUBLISH = {
  destination: 0n,
  routePointer: 32n,
  rewardPointer: 64n,
  allowPartial: 96n,
  routeLength: 128n,
  routeTuplePointer: 160n,
  routePortal: 256n,
  routeNativeAmount: 288n,
  routeTokensPointer: 320n,
  routeCallsPointer: 352n,
  routeTokensLength: 384n,
  routeToken: 416n,
  routeTokenAmount: 448n,
  callsLength: 480n,
  callPointer: 512n,
  callTarget: 544n,
  callDataPointer: 576n,
  callValue: 608n,
  callDataLength: 640n,
  /** The `transfer` selector and the first 28 bytes of its recipient word. */
  callDataHead: 672n,
  transferRecipient: 676n,
  transferAmount: 708n,
  rewardDeadline: 768n,
  rewardCreator: 800n,
  rewardProver: 832n,
  rewardNativeAmount: 864n,
  rewardTokensPointer: 896n,
  rewardTokensLength: 928n,
  rewardToken: 960n,
  rewardAmount: 992n,
} as const

const BPS = 10_000n

function requireStablecoin(
  chainId: number,
  token: Address,
  leg: 'from' | 'to',
) {
  const tokens = ECO_STABLECOINS[chainId]
  if (tokens === undefined) {
    throw new Error(`crossChainPermits: ECO does not route to chain ${chainId}`)
  }
  if (!tokens.some((t) => isAddressEqual(t, token))) {
    throw new Error(
      `crossChainPermits: ECO moves only USD stablecoins; the \`${leg}\` token on chain ${chainId} is ${token}`,
    )
  }
}

/** Provers deployed on both chains of a leg. */
function proversBetween(source: number, destination: number): Address[] {
  return (Object.keys(ECO_PROVERS) as Address[]).filter(
    (prover) =>
      ECO_PROVERS[prover].includes(source) &&
      ECO_PROVERS[prover].includes(destination),
  )
}

export function ecoPortal(chainId: number): Address {
  if (ECO_STABLECOINS[chainId] === undefined) {
    throw new Error(`crossChainPermits: ECO does not route to chain ${chainId}`)
  }
  return ECO_PORTAL
}

/** The word holding `transfer`'s selector and the head of its recipient. */
function transferHead(recipient: Address): Hex {
  return concat([TRANSFER_SELECTOR, slice(pad(recipient), 0, 28)])
}

const allOf = (rules: UniversalActionPolicyParamRule[]): ArgPolicyExpression =>
  rules
    .map((rule): ArgPolicyExpression => ({ type: 'rule', rule }))
    .reduceRight((right, left) => ({ type: 'and', left, right }))

const anyOf = (branches: ArgPolicyExpression[]): ArgPolicyExpression =>
  branches.reduce((left, right) => ({ type: 'or', left, right }))

/** The publish call, pinned to the permit's destinations, provers and prices. */
export function scopeEco(ctx: SettlementContext): ScopedAction {
  if (ctx.sourceTokens.length !== 1) {
    throw new Error(
      'crossChainPermits: ECO funds one reward token per chain; give exactly one `from` token on this chain',
    )
  }
  requireStablecoin(ctx.chainId, ctx.sourceTokens[0], 'from')
  if (!ctx.account) {
    throw new Error(
      'crossChainPermits: ECO refunds an unfilled reward to the account, so the session definition needs `account`',
    )
  }
  // The key sets the delivery against the reward; only a floor stops it from
  // paying a solver for next to nothing.
  if (ctx.cap === undefined || ctx.maxFeeBps === undefined) {
    throw new Error(
      'crossChainPermits: ECO needs maxAmount and maxFeeBps to bound what a reward must deliver',
    )
  }
  if (
    !Number.isInteger(ctx.maxFeeBps) ||
    ctx.maxFeeBps < 0 ||
    ctx.maxFeeBps >= 10_000
  ) {
    throw new Error(
      'crossChainPermits: maxFeeBps must be an integer in [0, 10000)',
    )
  }
  // An unfillable intent is refundable only after its reward deadline, so an
  // unbounded one would lock the reward for good.
  if (ctx.validUntil === undefined) {
    throw new Error(
      'crossChainPermits: ECO needs validUntil to bound how long an unfilled reward can stay locked',
    )
  }
  const cap = ctx.cap
  const floor = (cap * (BPS - BigInt(ctx.maxFeeBps))) / BPS
  const rules: UniversalActionPolicyParamRule[] = [
    pinValue(PUBLISH.routePointer, 0x80n),
    pinValue(PUBLISH.rewardPointer, 0x300n),
    pinValue(PUBLISH.allowPartial, 0n),
    pinValue(PUBLISH.routeLength, 0x260n),
    pinValue(PUBLISH.routeTuplePointer, 0x20n),
    pinValue(PUBLISH.routeNativeAmount, 0n),
    pinValue(PUBLISH.routeTokensPointer, 0xc0n),
    pinValue(PUBLISH.routeCallsPointer, 0x120n),
    pinValue(PUBLISH.routeTokensLength, 1n),
    pinValue(PUBLISH.callsLength, 1n),
    pinValue(PUBLISH.callPointer, 0x20n),
    pinValue(PUBLISH.callDataPointer, 0x60n),
    pinValue(PUBLISH.callValue, 0n),
    pinValue(PUBLISH.callDataLength, 0x44n),
    pin(PUBLISH.rewardCreator, ctx.account),
    pinValue(PUBLISH.rewardNativeAmount, 0n),
    pinValue(PUBLISH.rewardTokensPointer, 0xa0n),
    pinValue(PUBLISH.rewardTokensLength, 1n),
    pin(PUBLISH.rewardToken, ctx.sourceTokens[0]),
    cumulativeCap(PUBLISH.rewardAmount, cap),
    {
      condition: 'lessThanOrEqual',
      calldataOffset: PUBLISH.rewardDeadline,
      referenceValue: ctx.validUntil,
    },
  ]
  const legs = ctx.destinations.map((leg): ArgPolicyExpression => {
    requireStablecoin(leg.chainId, leg.token, 'to')
    if (leg.recipient === undefined) {
      throw new Error(
        "crossChainPermits: ECO needs a concrete recipient; 'any' cannot pin the route's transfer",
      )
    }
    const provers = proversBetween(ctx.chainId, leg.chainId)
    if (provers.length === 0) {
      throw new Error(
        `crossChainPermits: no Eco prover is deployed on both chain ${ctx.chainId} and chain ${leg.chainId}`,
      )
    }
    const legRules: UniversalActionPolicyParamRule[] = [
      pinValue(PUBLISH.destination, BigInt(leg.chainId)),
      pin(PUBLISH.routePortal, ECO_PORTAL),
      pin(PUBLISH.routeToken, leg.token),
      pin(PUBLISH.callTarget, leg.token),
      pinWord(PUBLISH.callDataHead, transferHead(leg.recipient)),
      pinWord(PUBLISH.transferRecipient, pad(leg.recipient)),
      {
        condition: 'greaterThanOrEqual',
        calldataOffset: PUBLISH.routeTokenAmount,
        referenceValue: floor,
      },
      {
        condition: 'greaterThanOrEqual',
        calldataOffset: PUBLISH.transferAmount,
        referenceValue: floor,
      },
    ]
    // The prover OR nests inside its leg, so the rule count grows with legs
    // plus provers rather than their product.
    return {
      type: 'and',
      left: allOf(legRules),
      right: anyOf(
        provers.map((prover) => allOf([pin(PUBLISH.rewardProver, prover)])),
      ),
    }
  })
  return {
    target: ctx.target,
    selector: PUBLISH_AND_FUND_SELECTOR,
    policies: [
      {
        type: 'arg-policy',
        valueLimitPerUse: 0n,
        expression: { type: 'and', left: allOf(rules), right: anyOf(legs) },
      },
      ...ctx.timeFrame,
    ],
  }
}
