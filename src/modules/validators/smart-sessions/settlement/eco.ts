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
import { cumulativeCap, floorFor, pin, pinValue, pinWord } from '../swap/rules'
import { STABLE_DECIMALS } from '../swap/stable-floor'
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
 * creator after the reward deadline, which only a deadline on the session
 * bounds. This assumes EVM destinations and a Portal that keeps re-encoding.
 *
 * The route's token count is not pinned either: the pinned route token, call
 * count and transfer head leave 3 as the only other canonical count, whose
 * second token is the call count pin, address 1. `_fulfill` pulls it with OZ
 * 5.0 `safeTransferFrom`, which reverts on a code-less target. The call's
 * value is not pinned: `Executor` bubbles the revert of every served
 * stablecoin's non-payable `transfer`. Both were checked on every ECO chain.
 *
 * Neither native amount nor `allowPartial` is pinned. `valueLimitPerUse: 0`
 * holds `msg.value` at 0, so `_fundNative` fills reward native only from a
 * vault a third party pre-funded; partial funding pulls at most the capped
 * reward and `Vault.withdraw` pays at most what the vault holds; route native
 * comes from the solver. The account never pays more than the capped reward.
 *
 * Fills are permissionless and the filler names the claimant, so a key can fill
 * its own intent: the delivery floor is the whole price bound. With `maxFeeBps`
 * it is the cap less the most the solver may keep, rescaled between two served
 * USD stablecoins' decimals. With `to.minAmount` it is the owner's own amount
 * of the `to` token, for any two served stablecoins; given both, the higher
 * floor applies.
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

/**
 * How far ahead a set `validUntil` must reach: the session pins Eco's reward
 * deadline under it, and the orchestrator publishes Eco's quoted deadline about
 * 7 days out.
 */
export const ECO_MIN_VALIDITY_SECONDS = 7n * 24n * 60n * 60n

/**
 * Eco's solvers deliver only the stablecoins it serves on a chain; any other
 * token never fills and locks the reward until its deadline.
 */
function requireServed(
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
}

/**
 * The decimals of a served Eco stablecoin the `maxFeeBps` floor prices 1:1, as
 * the served `usdStablecoins` vouch for them. Eco's bare address list carries
 * none, and the permit's own word is not taken.
 */
function stableDecimals(
  settlement: SettlementCatalog,
  chainId: number,
  token: Address,
  leg: 'from' | 'to',
): number {
  const usd = (settlement[chainId]?.usdStablecoins ?? []).filter((t) =>
    isAddressEqual(t.address, token),
  )
  const refuse = (why: string) =>
    new SettlementLayerRefusal(
      `crossChainPermits: ECO_IE prices reward against delivery 1:1, so the \`${leg}\` token ${token} on chain ${chainId} must be a served USD stablecoin with known decimals; ${why}`,
    )
  if (usd.length === 0) {
    throw refuse('the orchestrator serves no usdStablecoins entry for it')
  }
  // Two entries could disagree, and the floor would take whichever came first.
  if (usd.length > 1) {
    throw refuse(`it appears ${usd.length} times in usdStablecoins`)
  }
  // A wrong scale moves the floor by orders of magnitude.
  if (!STABLE_DECIMALS.has(usd[0].decimals)) {
    throw refuse(`it has ${usd[0].decimals} decimals; expected 6 or 18`)
  }
  return usd[0].decimals
}

/** The token's served decimals when `stableDecimals` would accept them. */
export function knownDecimals(
  settlement: SettlementCatalog,
  chainId: number,
  token: Address,
): number | undefined {
  const usd = (settlement[chainId]?.usdStablecoins ?? []).filter((t) =>
    isAddressEqual(t.address, token),
  )
  return usd.length === 1 && STABLE_DECIMALS.has(usd[0].decimals)
    ? usd[0].decimals
    : undefined
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
  // `maxFeeBps` prices the reward 1:1 against delivery; without it every leg's
  // owner-set `to.minAmount` is the floor, in that leg's own token.
  requireServed(ctx.settlement, ctx.chainId, ctx.sourceTokens[0], 'from')
  const fromDecimals =
    ctx.maxFeeBps === undefined
      ? undefined
      : stableDecimals(ctx.settlement, ctx.chainId, ctx.sourceTokens[0], 'from')
  if (!ctx.account) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: ECO_IE refunds an unfilled reward to the account, so the session definition needs `account`',
    )
  }
  // The key fills its own intent and names itself claimant, so a floor on
  // delivery is all that stops a reward paying for next to nothing.
  if (
    ctx.cap === undefined ||
    (ctx.maxFeeBps === undefined &&
      ctx.destinations.some((leg) => leg.minAmount === undefined))
  ) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: ECO_IE needs maxAmount and maxFeeBps to bound what a reward must deliver (or maxAmount and a `to.minAmount` on every leg)',
    )
  }
  if (
    ctx.destinations.some(
      (leg) => leg.minAmount !== undefined && leg.minAmount <= 0n,
    )
  ) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: ECO_IE needs a positive `to.minAmount`',
    )
  }
  if (
    ctx.maxFeeBps !== undefined &&
    (!Number.isInteger(ctx.maxFeeBps) ||
      ctx.maxFeeBps < 0 ||
      ctx.maxFeeBps >= 10_000)
  ) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: maxFeeBps must be an integer in [0, 10000)',
    )
  }
  // `validUntil` is the session's earliest deadline. Both deadlines stay
  // unpinned only when the session has no deadline at all (no validUntil on the
  // permit and none on the session): an unfilled reward then has no refund
  // deadline.
  const validUntil = ctx.validUntil
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (validUntil !== undefined && validUntil < now + ECO_MIN_VALIDITY_SECONDS) {
    throw new SettlementLayerRefusal(
      "crossChainPermits: ECO_IE needs validUntil at least 7 days ahead: Eco's reward deadline is ~7 days out and the session pins it",
    )
  }
  // Each source chain's session floors its own capped reward with the same
  // absolute amount, so it bounds the rate only where every cap is the same.
  if (ctx.maxFeeBps === undefined && new Set(ctx.fromCaps ?? []).size > 1) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: an ECO_IE `to.minAmount` floors every source chain alike, so `from` legs with different maxAmount need maxFeeBps, which scales with each cap',
    )
  }
  const cap = ctx.cap
  const maxFeeBps = ctx.maxFeeBps
  const rules: UniversalActionPolicyParamRule[] = [
    pinValue(PUBLISH.routePointer, 0x80n),
    pinValue(PUBLISH.rewardPointer, 0x300n),
    pinValue(PUBLISH.callsLength, 1n),
    pinValue(PUBLISH.callDataLength, 0x44n),
    pin(PUBLISH.rewardCreator, ctx.account),
    pinValue(PUBLISH.rewardTokensPointer, 0xa0n),
    pinValue(PUBLISH.rewardTokensLength, 1n),
    pin(PUBLISH.rewardToken, ctx.sourceTokens[0]),
    cumulativeCap(PUBLISH.rewardAmount, cap),
    ...(validUntil === undefined
      ? []
      : ([
          {
            condition: 'lessThanOrEqual',
            calldataOffset: PUBLISH.rewardDeadline,
            referenceValue: validUntil,
          },
          // The route deadline bounds when a solver may still fill; the
          // session's window bounds the whole settlement, not just its refund.
          {
            condition: 'lessThanOrEqual',
            calldataOffset: PUBLISH.routeDeadline,
            referenceValue: validUntil,
          },
        ] satisfies UniversalActionPolicyParamRule[])),
  ]
  // Two legs that pin the same delivery become an OR, so the lower floor binds.
  const twin = ctx.destinations.find((leg, i) =>
    ctx.destinations.some(
      (other, j) =>
        j < i &&
        other.chainId === leg.chainId &&
        isAddressEqual(other.token, leg.token) &&
        (other.recipient === undefined || leg.recipient === undefined
          ? other.recipient === leg.recipient
          : isAddressEqual(other.recipient, leg.recipient)) &&
        other.minAmount !== leg.minAmount,
    ),
  )
  if (twin) {
    throw new SettlementLayerRefusal(
      `crossChainPermits: ECO_IE names the \`to\` leg ${twin.token} on chain ${twin.chainId} twice with different \`to.minAmount\`; give it once`,
    )
  }
  const legs = ctx.destinations.map((leg) => {
    requireServed(ctx.settlement, leg.chainId, leg.token, 'to')
    // The cap less what the solver may keep, rescaled from the reward's
    // decimals to the delivery's; with `to.minAmount` too, the stricter wins.
    const feeFloor =
      maxFeeBps === undefined || fromDecimals === undefined
        ? 0n
        : floorFor(
            cap,
            BPS - BigInt(maxFeeBps),
            BPS,
            fromDecimals,
            stableDecimals(ctx.settlement, leg.chainId, leg.token, 'to'),
          )
    const floor =
      leg.minAmount !== undefined && leg.minAmount > feeFloor
        ? leg.minAmount
        : feeFloor
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
    ],
  }
}
