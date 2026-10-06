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
import { compareHexValues } from '../../ordering'
import { cumulativeCap, pin, pinValue, pinWord } from '../swap/rules'
import type {
  ArgPolicyExpression,
  ScopedAction,
  UniversalActionPolicyParamRule,
} from '../types'
import { SettlementLayerRefusal, served } from './served'
import type { SettlementCatalog, SettlementContext } from './types'

/**
 * ECO — Eco Routes, `Portal.publishAndFund` with Eco's quoted route bytes
 * forwarded verbatim by the orchestrator.
 *
 * The recipient lives inside the vendor route, and the reward's offsets move
 * with the route's length, so the session pins the one shape the orchestrator
 * accepts end to end: an ERC-20 reward and a single `transfer` delivery.
 * Every calldata pointer, the reward's tokens pointer and every other count is
 * pinned so no field can alias another. The route's own pointers and byte length are
 * not: the destination Portal
 * (0xEC000769A73b70e16f361a442292500b3BCf4A85, verified source on Base
 * Blockscout) checks every fill and cancel in `_validateRoute`, which hashes
 * `abi.encode(route)` and reverts `InvalidHash`, so only canonical bytes are
 * fillable, and canonical bytes with these counts have exactly the layout the
 * offsets assume. Any other layout is never filled and refunds to the pinned
 * creator after the pinned deadline. This assumes EVM destinations and a Portal
 * that keeps re-encoding.
 *
 * The route's token count is not pinned either: the pinned route token, call
 * count and transfer head leave 3 as the only other canonical count, whose
 * second token is the call count pin, address 1. `_fulfill` pulls it with OZ
 * 5.0 `safeTransferFrom`, which reverts on a code-less target. The call's
 * value is not pinned: `Executor` bubbles the revert of every served
 * stablecoin's non-payable `transfer`. Both were checked on every ECO chain.
 */

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
  routeDeadline: 224n,
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

const ECO_DECIMALS = 6

/**
 * How far ahead `validUntil` must reach: the session pins Eco's reward deadline
 * under it, and the orchestrator publishes Eco's quoted deadline about 7 days out.
 */
export const ECO_MIN_VALIDITY_SECONDS = 7n * 24n * 60n * 60n

/**
 * The delivery floor compares reward and delivery in raw units 1:1, which only
 * holds between USD stablecoins of the same decimals. Eco's bare address list
 * carries none, so the served `usdStablecoins` must vouch for 6.
 */
function requireStablecoin(
  settlement: SettlementCatalog,
  chainId: number,
  token: Address,
  leg: 'from' | 'to',
) {
  if (
    !served(settlement, chainId, 'eco').stablecoins.some((t) =>
      isAddressEqual(t, token),
    )
  ) {
    throw new SettlementLayerRefusal(
      `crossChainPermits: ECO_IE moves only USD stablecoins; the \`${leg}\` token on chain ${chainId} is ${token}`,
    )
  }
  const usd = settlement[chainId]?.usdStablecoins?.find((t) =>
    isAddressEqual(t.address, token),
  )
  if (usd?.decimals !== ECO_DECIMALS) {
    throw new SettlementLayerRefusal(
      `crossChainPermits: ECO_IE prices reward against delivery 1:1, so the \`${leg}\` token ${token} on chain ${chainId} must be a served ${ECO_DECIMALS}-decimal USD stablecoin; ${usd === undefined ? 'the orchestrator serves no usdStablecoins entry for it' : `it has ${usd.decimals} decimals`}`,
    )
  }
}

/**
 * Provers served on both chains of a leg. An unlisted prover could attest a
 * fill that never happened; one with no code on the source chain makes
 * `refund` revert and locks the reward.
 */
export function proversBetween(
  settlement: SettlementCatalog,
  source: number,
  destination: number,
): Address[] {
  const there = served(settlement, destination, 'eco').provers
  // Sorted so the policy, and so the permissionId, ignores the served order.
  return served(settlement, source, 'eco')
    .provers.filter((prover) => there.some((p) => isAddressEqual(p, prover)))
    .map((prover) => prover.toLowerCase() as Address)
    .sort(compareHexValues)
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

const allOfExpressions = (parts: ArgPolicyExpression[]): ArgPolicyExpression =>
  parts.reduceRight((right, left) => ({ type: 'and', left, right }))

/**
 * The same check on the same word; a usage-limited rule is never the same, as
 * hoisted out of the leg OR it would count calls its branch never admits.
 */
export const sameRule = (
  a: UniversalActionPolicyParamRule,
  b: UniversalActionPolicyParamRule,
) =>
  a.usageLimit === undefined &&
  b.usageLimit === undefined &&
  a.condition === b.condition &&
  a.calldataOffset === b.calldataOffset &&
  BigInt(a.referenceValue) === BigInt(b.referenceValue)

/** The publish call, pinned to the permit's destinations, provers and prices. */
export function scopeEco(ctx: SettlementContext): ScopedAction {
  if (ctx.sourceTokens.length !== 1) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: ECO_IE funds one reward token per chain; give exactly one `from` token on this chain',
    )
  }
  requireStablecoin(ctx.settlement, ctx.chainId, ctx.sourceTokens[0], 'from')
  if (!ctx.account) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: ECO_IE refunds an unfilled reward to the account, so the session definition needs `account`',
    )
  }
  // The key sets the delivery against the reward; only a floor stops it from
  // paying a solver for next to nothing.
  if (ctx.cap === undefined || ctx.maxFeeBps === undefined) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: ECO_IE needs maxAmount and maxFeeBps to bound what a reward must deliver',
    )
  }
  if (
    !Number.isInteger(ctx.maxFeeBps) ||
    ctx.maxFeeBps < 0 ||
    ctx.maxFeeBps >= 10_000
  ) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: maxFeeBps must be an integer in [0, 10000)',
    )
  }
  // An unfillable intent is refundable only after its reward deadline, so an
  // unbounded one would lock the reward for good.
  if (ctx.validUntil === undefined) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: ECO_IE needs validUntil to bound how long an unfilled reward can stay locked',
    )
  }
  // Measured from when the session can first act: a later validAfter moves
  // the first quote, and its ~7-day reward deadline, with it.
  const now = BigInt(Math.floor(Date.now() / 1000))
  const firstUse =
    ctx.validAfter !== undefined && ctx.validAfter > now ? ctx.validAfter : now
  if (ctx.validUntil < firstUse + ECO_MIN_VALIDITY_SECONDS) {
    throw new SettlementLayerRefusal(
      "crossChainPermits: ECO_IE needs validUntil at least 7 days after it can first act (now or validAfter): Eco's reward deadline is ~7 days out and the session pins it",
    )
  }
  const cap = ctx.cap
  // Round up: a floor rounded down would let the solver keep more than maxFeeBps.
  const feeBps = BigInt(ctx.maxFeeBps)
  const floor = (cap * (BPS - feeBps) + BPS - 1n) / BPS
  const rules: UniversalActionPolicyParamRule[] = [
    pinValue(PUBLISH.routePointer, 0x80n),
    pinValue(PUBLISH.rewardPointer, 0x300n),
    pinValue(PUBLISH.allowPartial, 0n),
    pinValue(PUBLISH.routeNativeAmount, 0n),
    pinValue(PUBLISH.callsLength, 1n),
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
    // The route deadline bounds when a solver may still fill; the session's
    // window bounds the whole settlement, not just its refund.
    {
      condition: 'lessThanOrEqual',
      calldataOffset: PUBLISH.routeDeadline,
      referenceValue: ctx.validUntil,
    },
  ]
  const legs = ctx.destinations.map((leg) => {
    requireStablecoin(ctx.settlement, leg.chainId, leg.token, 'to')
    if (leg.recipient === undefined) {
      throw new SettlementLayerRefusal(
        "crossChainPermits: ECO_IE needs a concrete recipient; 'any' cannot pin the route's transfer",
      )
    }
    const provers = proversBetween(ctx.settlement, ctx.chainId, leg.chainId)
    if (provers.length === 0) {
      throw new SettlementLayerRefusal(
        `crossChainPermits: no Eco prover is deployed on both chain ${ctx.chainId} and chain ${leg.chainId}`,
      )
    }
    const legRules: UniversalActionPolicyParamRule[] = [
      pinValue(PUBLISH.destination, BigInt(leg.chainId)),
      pin(
        PUBLISH.routePortal,
        served(ctx.settlement, leg.chainId, 'eco').portal,
      ),
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
    return { rules: legRules, provers }
  })
  // What every leg pins moves out of the OR, stored once instead of per leg:
  // (A and X) or (A and Y) is A and (X or Y).
  const shared = legs[0].rules.filter((rule) =>
    legs.every((leg) => leg.rules.some((other) => sameRule(other, rule))),
  )
  const sharedProvers = legs.every(
    (leg) =>
      leg.provers.length === legs[0].provers.length &&
      leg.provers.every((prover, i) => prover === legs[0].provers[i]),
  )
  // The prover OR nests inside its leg, so the rule count grows with legs
  // plus provers rather than their product.
  const proverOr = (provers: readonly Address[]) =>
    anyOf(provers.map((prover) => allOf([pin(PUBLISH.rewardProver, prover)])))
  const branches = legs.map((leg) => {
    const own = leg.rules.filter(
      (rule) => !shared.some((other) => sameRule(other, rule)),
    )
    return [
      ...(own.length ? [allOf(own)] : []),
      ...(sharedProvers ? [] : [proverOr(leg.provers)]),
    ]
  })
  const expression = [
    allOf([...rules, ...shared]),
    ...(sharedProvers ? [proverOr(legs[0].provers)] : []),
    // A leg left with nothing of its own admits everything the others do.
    ...(branches.some((branch) => branch.length === 0)
      ? []
      : [anyOf(branches.map(allOfExpressions))]),
  ]
  return {
    target: ctx.target,
    selector: PUBLISH_AND_FUND_SELECTOR,
    policies: [
      {
        type: 'arg-policy',
        valueLimitPerUse: 0n,
        expression: allOfExpressions(expression),
      },
      ...ctx.timeFrame,
    ],
  }
}
