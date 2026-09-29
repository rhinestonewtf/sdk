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
 * Provers Eco's solvers quote, each checked on-chain to point at the Portal.
 * An unlisted prover could attest a fill that never happened and release the
 * reward, so the reward's prover is pinned to these.
 */
export const ECO_PROVERS: readonly Address[] = [
  '0xec004Ab4870c4e177c66949329dCdb503CE41022', // HyperProver
  '0xceBB7cDDBA4734C7130BF114a37C2dA4C5f3c473', // CCIPProver
]

/**
 * USD stablecoins per chain Eco routes between. The delivery floor compares a
 * reward and a delivery 1:1, which only holds between USD stablecoins.
 */
export const ECO_STABLECOINS: Readonly<
  Record<
    number,
    readonly { readonly token: Address; readonly decimals: number }[]
  >
> = {
  1: [
    { token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { token: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 },
  ],
  10: [
    { token: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', decimals: 6 },
    { token: '0x01bFF41798a0BcF287b996046Ca68b395DbC1071', decimals: 6 },
    { token: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', decimals: 6 },
  ],
  130: [
    { token: '0x078d782b760474a361dda0af3839290b0ef57ad6', decimals: 6 },
    { token: '0x9151434b16b9763660705744891fA906F660EcC5', decimals: 6 },
  ],
  137: [
    { token: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', decimals: 6 },
    { token: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', decimals: 6 },
  ],
  999: [
    { token: '0xb88339CB7199b77E23DB6E890353E22632Ba630f', decimals: 6 },
    { token: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', decimals: 6 },
  ],
  2020: [{ token: '0x0b7007c13325c48911f73a2dad5fa5dcbf808adc', decimals: 6 }],
  8453: [{ token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 }],
  9745: [
    { token: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', decimals: 6 },
    { token: '0x2d661C89D812261039AF9764eceaAee884f5F67F', decimals: 6 },
  ],
  42161: [
    { token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    { token: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', decimals: 6 },
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

function stablecoin(chainId: number, token: Address, leg: 'from' | 'to') {
  const tokens = ECO_STABLECOINS[chainId]
  if (tokens === undefined) {
    throw new Error(`crossChainPermits: ECO does not route to chain ${chainId}`)
  }
  const match = tokens.find((t) => isAddressEqual(t.token, token))
  if (!match) {
    throw new Error(
      `crossChainPermits: ECO moves only USD stablecoins; the \`${leg}\` token on chain ${chainId} is ${token}`,
    )
  }
  return match
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

/** The publish call, pinned to the permit's destinations, prover and prices. */
export function scopeEco(ctx: SettlementContext): ScopedAction {
  if (ctx.sourceTokens.length !== 1) {
    throw new Error(
      'crossChainPermits: ECO funds one reward token per chain; give exactly one `from` token on this chain',
    )
  }
  const source = stablecoin(ctx.chainId, ctx.sourceTokens[0], 'from')
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
  const cap = ctx.cap
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
    pin(PUBLISH.rewardToken, source.token),
    cumulativeCap(PUBLISH.rewardAmount, cap),
  ]
  if (ctx.validUntil !== undefined) {
    // An unfilled reward is only refundable after its deadline.
    rules.push({
      condition: 'lessThanOrEqual',
      calldataOffset: PUBLISH.rewardDeadline,
      referenceValue: ctx.validUntil,
    })
  }
  const alternatives = ctx.destinations.flatMap((leg) => {
    const delivered = stablecoin(leg.chainId, leg.token, 'to')
    if (leg.recipient === undefined) {
      throw new Error(
        "crossChainPermits: ECO needs a concrete recipient; 'any' cannot pin the route's transfer",
      )
    }
    // Scale the reward cap into the delivered token's units, then take the fee.
    const floor =
      (cap *
        (BPS - BigInt(ctx.maxFeeBps as number)) *
        10n ** BigInt(delivered.decimals)) /
      (BPS * 10n ** BigInt(source.decimals))
    const legRules = [
      pinValue(PUBLISH.destination, BigInt(leg.chainId)),
      pin(PUBLISH.routePortal, ECO_PORTAL),
      pin(PUBLISH.routeToken, delivered.token),
      pin(PUBLISH.callTarget, delivered.token),
      pinWord(PUBLISH.callDataHead, transferHead(leg.recipient)),
      pinWord(PUBLISH.transferRecipient, pad(leg.recipient)),
      {
        condition: 'greaterThanOrEqual',
        calldataOffset: PUBLISH.routeTokenAmount,
        referenceValue: floor,
      } as const,
      {
        condition: 'greaterThanOrEqual',
        calldataOffset: PUBLISH.transferAmount,
        referenceValue: floor,
      } as const,
    ]
    return ECO_PROVERS.map((prover) => [
      ...legRules,
      pin(PUBLISH.rewardProver, prover),
    ])
  })
  const action = swapAction(
    ctx.target,
    PUBLISH_AND_FUND_SELECTOR,
    rules,
    alternatives,
  )
  return { ...action, policies: [...(action.policies ?? []), ...ctx.timeFrame] }
}
