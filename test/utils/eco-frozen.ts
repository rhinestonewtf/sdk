import {
  type Address,
  concat,
  type Hex,
  isAddressEqual,
  pad,
  slice,
  toFunctionSelector,
} from 'viem'
import type {
  SettlementCatalog,
  SettlementContext,
} from '../../src/modules/validators/smart-sessions/settlement/types'
import type {
  ArgPolicyExpression,
  ScopedAction,
  UniversalActionPolicyParamRule,
} from '../../src/modules/validators/smart-sessions/types'

/**
 * ECO_IE's `scopeEco` frozen as of 366001ca, so the differential test can show
 * the live builder emits the same policy wherever its behaviour is unchanged.
 * Self-contained: nothing here moves when the live helpers do, except the
 * validUntil check, which follows the live builder since validAfter was removed.
 */

const PUBLISH = {
  destination: 0n,
  routePointer: 32n,
  rewardPointer: 64n,
  routeDeadline: 224n,
  routePortal: 256n,
  routeToken: 416n,
  routeTokenAmount: 448n,
  callsLength: 480n,
  callTarget: 544n,
  callDataLength: 640n,
  callDataHead: 672n,
  transferRecipient: 676n,
  transferAmount: 708n,
  rewardDeadline: 768n,
  rewardCreator: 800n,
  rewardProver: 832n,
  rewardTokensPointer: 896n,
  rewardTokensLength: 928n,
  rewardToken: 960n,
  rewardAmount: 992n,
} as const

const PUBLISH_AND_FUND_SELECTOR = toFunctionSelector(
  'function publishAndFund(uint64 destination, bytes route, (uint64 deadline,address creator,address prover,uint256 nativeAmount,(address token,uint256 amount)[] tokens) reward, bool allowPartial)',
)

class SettlementLayerRefusal extends Error {}

function served(settlement: SettlementCatalog, chainId: number, _: 'eco') {
  const block = settlement[chainId]?.eco
  if (block === undefined) {
    throw new SettlementLayerRefusal(
      `crossChainPermits: ECO_IE does not route to chain ${chainId}`,
    )
  }
  return block
}

function compareHexValues(left: Hex, right: Hex): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  if (leftValue === rightValue) return 0
  return leftValue < rightValue ? -1 : 1
}

const pinValue = (
  calldataOffset: bigint,
  referenceValue: bigint,
): UniversalActionPolicyParamRule => ({
  condition: 'equal',
  calldataOffset,
  referenceValue,
})
const pinWord = (
  calldataOffset: bigint,
  referenceValue: Hex,
): UniversalActionPolicyParamRule => ({
  condition: 'equal',
  calldataOffset,
  referenceValue,
})
const pin = (
  calldataOffset: bigint,
  referenceValue: Address,
): UniversalActionPolicyParamRule => ({
  condition: 'equal',
  calldataOffset,
  referenceValue,
})
const cumulativeCap = (
  calldataOffset: bigint,
  cap: bigint,
): UniversalActionPolicyParamRule => ({
  condition: 'lessThanOrEqual',
  calldataOffset,
  referenceValue: cap,
  usageLimit: cap,
})

const TRANSFER_SELECTOR = toFunctionSelector('transfer(address,uint256)')
const BPS = 10_000n
const ECO_DECIMALS = 6
const ECO_MIN_VALIDITY_SECONDS = 7n * 24n * 60n * 60n

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

function proversBetween(
  settlement: SettlementCatalog,
  source: number,
  destination: number,
): Address[] {
  const there = served(settlement, destination, 'eco').provers
  return served(settlement, source, 'eco')
    .provers.filter((prover) => there.some((p) => isAddressEqual(p, prover)))
    .map((prover) => prover.toLowerCase() as Address)
    .sort(compareHexValues)
}

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

const sameRule = (
  a: UniversalActionPolicyParamRule,
  b: UniversalActionPolicyParamRule,
) =>
  a.usageLimit === undefined &&
  b.usageLimit === undefined &&
  a.condition === b.condition &&
  a.calldataOffset === b.calldataOffset &&
  BigInt(a.referenceValue) === BigInt(b.referenceValue)

export function frozenScopeEco(ctx: SettlementContext): ScopedAction {
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
  // Historical: the live builder now leaves the deadlines unpinned here.
  if (ctx.validUntil === undefined) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: ECO_IE needs validUntil to bound how long an unfilled reward can stay locked',
    )
  }
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (ctx.validUntil < now + ECO_MIN_VALIDITY_SECONDS) {
    throw new SettlementLayerRefusal(
      "crossChainPermits: ECO_IE needs validUntil at least 7 days ahead: Eco's reward deadline is ~7 days out and the session pins it",
    )
  }
  const cap = ctx.cap
  const feeBps = BigInt(ctx.maxFeeBps)
  const floor = (cap * (BPS - feeBps) + BPS - 1n) / BPS
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
    {
      condition: 'lessThanOrEqual',
      calldataOffset: PUBLISH.rewardDeadline,
      referenceValue: ctx.validUntil,
    },
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
  const shared = legs[0].rules.filter((rule) =>
    legs.every((leg) => leg.rules.some((other) => sameRule(other, rule))),
  )
  const sharedProvers = legs.every(
    (leg) =>
      leg.provers.length === legs[0].provers.length &&
      leg.provers.every((prover, i) => prover === legs[0].provers[i]),
  )
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
