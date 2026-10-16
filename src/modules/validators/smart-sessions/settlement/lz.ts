import {
  type Address,
  type Hex,
  isAddressEqual,
  maxUint64,
  maxUint256,
  pad,
  toFunctionSelector,
} from 'viem'
import {
  allOf,
  anyOf,
  atLeast,
  cumulativeCap,
  pin,
  pinValue,
  pinWord,
} from '../swap/rules'
import type {
  ArgPolicyExpression,
  ScopedAction,
  UniversalActionPolicyParamRule,
} from '../types'
import { OFT_SEND_SELECTOR, SEND } from './oft'
import { SettlementLayerRefusal, served } from './served'
import type { SettlementContext } from './types'

/**
 * LZ — USDC over the LayerZero Value Transfer API: `approve(TransferDelegate)`
 * then `LZMultiCall.execute(calls, quoteId)`. LZMultiCall runs any call it is
 * handed, so every nested call's shape and redirectable argument is pinned,
 * except what LZMultiCall or the target already refuses (see `batch` and
 * `pull`). Two routes are accepted: CCTP, and Stargate TAXI only into a leg no
 * CCTP route reaches (CCTP is cheaper there); BUS is refused.
 *
 * A Stargate send's `minAmountLD` is pinned only against an owner-given
 * `to.minAmount`: the amount sent varies, and a rule compares with a constant.
 */

/**
 * Circle's TokenMessengerV2, which the API's CCTP route approves and burns
 * through on every mainnet. `/chains` does not serve it inside `lz.cctp`, and
 * Plasma has no `cctp` block to borrow it from.
 */
const LZ_CCTP_TOKEN_MESSENGER: Address =
  '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'

/**
 * The most relay fee the key may send LayerZero's receiver, in USDC units:
 * ~10x the live fee into Ethereum, the dearest destination. A cumulative
 * ceiling: on a reusable session it bounds every relay fee the session pays.
 */
export const LZ_CCTP_MAX_RELAY_FEE = 1_000_000n

export const LZ_EXECUTE_SELECTOR = toFunctionSelector(
  'execute((address,uint256,bytes)[],bytes32)',
)
const DELEGATE_TRANSFER_FROM = toFunctionSelector(
  'delegateTransferFrom(address,address,address,uint256)',
)
const APPROVE = toFunctionSelector('approve(address,uint256)')
const TRANSFER = toFunctionSelector('transfer(address,uint256)')
const DEPOSIT_FOR_BURN = toFunctionSelector(
  'depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)',
)
const SWEEP = toFunctionSelector('sweep(address[],address)')

type Rule = UniversalActionPolicyParamRule
/** Offset of a nested call's argument word, from the start of `execute`'s args. */
type At = (offset: bigint) => bigint

interface NestedCall {
  readonly target: Address
  readonly selector: Hex
  /** Calldata length, selector included. */
  readonly length: number
  /** LZMultiCall itself reverts on any other length or selector. */
  readonly shapeChecked?: boolean
  readonly args: (at: At) => Rule[]
}

const ceil32 = (n: number) => BigInt(Math.ceil(n / 32) * 32)

const and = (terms: ArgPolicyExpression[]): ArgPolicyExpression =>
  terms.reduceRight((right, left) => ({ type: 'and', left, right }))

/**
 * The same check on the same word. A usage-limited rule is never the same: one
 * hoisted out of an OR would count on every call, not only when its branch runs.
 */
export const sameRule = (a: Rule, b: Rule) =>
  a.usageLimit === undefined &&
  b.usageLimit === undefined &&
  a.condition === b.condition &&
  a.calldataOffset === b.calldataOffset &&
  BigInt(a.referenceValue) === BigInt(b.referenceValue)

/**
 * The pins of an `execute` batch under the canonical encoding, below the
 * `calls` pointer every route shares, and each call's argument accessor.
 */
function batch(calls: readonly NestedCall[]): {
  readonly rules: Rule[]
  readonly args: At[]
} {
  const rules: Rule[] = [pinValue(0x40n, BigInt(calls.length))]
  const args: At[] = []
  let relative = BigInt(calls.length) * 32n
  calls.forEach((call, i) => {
    const start = 0x60n + relative
    const data = start + 128n
    const at: At = (offset) => data + 4n + offset
    // No call's value is pinned: the send's is the messaging fee, and every
    // other target is non-payable, a revert LZMultiCall bubbles.
    rules.push(
      pinValue(0x60n + BigInt(i) * 32n, relative),
      pin(start, call.target),
      pinValue(start + 64n, 0x60n),
      // The word ending at the selector: the length's low 28 bytes, then the
      // selector. A length above 2^224 fails to decode, so this pins both.
      ...(call.shapeChecked
        ? []
        : [
            pinValue(
              data - 28n,
              (BigInt(call.length) << 32n) | BigInt(call.selector),
            ),
          ]),
      ...call.args(at),
    )
    args.push(at)
    relative += 128n + ceil32(call.length)
  })
  return { rules, args }
}

type Leg = SettlementContext['destinations'][number]

interface Route {
  readonly rules: Rule[]
  /** How many nested calls the batch makes. */
  readonly calls: number
  /** Pins a leg this route delivers; undefined for one it cannot. */
  readonly leg: (leg: Leg) => Rule[] | undefined
  /** Whether this route reaches the leg's chain at all, whatever its token. */
  readonly reaches: (leg: Leg) => boolean
  /** The offset of the amount the batch pulls from the account. */
  readonly pull: bigint
  /**
   * Usage-limited rules, evaluated last: a passing limited rule counts even if
   * its branch then fails.
   */
  readonly limits: Rule[]
}

/** The execute call, pinned to the permit's destinations, recipients and cap. */
export function scopeLz(ctx: SettlementContext): ScopedAction {
  if (ctx.sourceTokens.length !== 1) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: LZ moves one token (USDC) per chain; give exactly one `from` token on this chain',
      { code: 'ONE_SOURCE_TOKEN', chainId: ctx.chainId },
    )
  }
  const account = ctx.account
  if (!account) {
    throw new SettlementLayerRefusal(
      'crossChainPermits: LZ sweeps what it does not bridge back to the account, so the session definition needs `account`',
      { code: 'ACCOUNT_REQUIRED' },
    )
  }
  const [token] = ctx.sourceTokens
  const source = served(ctx.settlement, ctx.chainId, 'lz')
  const { multiCall, transferDelegate } = source
  const servedLz = (leg: Leg) => ctx.settlement[leg.chainId]?.lz
  const cap = (offset: bigint) =>
    ctx.cap === undefined ? [] : [cumulativeCap(offset, ctx.cap)]
  const crossChain = (leg: Leg) => leg.chainId !== ctx.chainId
  const recipient = (offset: bigint, leg: Leg) =>
    leg.recipient === undefined ? [] : [pinWord(offset, pad(leg.recipient))]

  // LZMultiCall routes a call to its own TransferDelegate through
  // `_handleTransfer`, which reverts unless the data is 132 bytes of
  // `delegateTransferFrom` pulling from the caller, the account.
  const pull: NestedCall = {
    target: transferDelegate,
    selector: DELEGATE_TRANSFER_FROM,
    length: 132,
    shapeChecked: true,
    args: (at) => [pin(at(0n), token), pin(at(64n), multiCall)],
  }
  const sweep: NestedCall = {
    target: multiCall,
    selector: SWEEP,
    length: 164,
    args: (at) => [
      pinValue(at(0n), 0x40n),
      pin(at(32n), account),
      pinValue(at(64n), 2n),
      pin(at(96n), token),
      pinValue(at(128n), 0n),
    ],
  }
  const approve = (spender: Address): NestedCall => ({
    target: token,
    selector: APPROVE,
    length: 68,
    args: (at) => [pin(at(0n), spender)],
  })
  const routes: Route[] = []
  const cctp = source.cctp
  const cctpFrom = cctp !== undefined && isAddressEqual(token, cctp.token)
  // A route exists where both chains carry its block.
  const cctpLinks = (leg: Leg) =>
    cctpFrom && crossChain(leg) && servedLz(leg)?.cctp !== undefined
  // A leg whose token CCTP does not mint, such as a Stargate USDC, stays
  // Stargate's.
  const cctpReaches = (leg: Leg) => {
    const dst = servedLz(leg)?.cctp
    return cctpLinks(leg) && !!dst && isAddressEqual(leg.token, dst.token)
  }
  const decimals = (chainId: number, address: Address) =>
    ctx.settlement[chainId]?.usdStablecoins?.find((t) =>
      isAddressEqual(t.address, address),
    )?.decimals
  // The floor is a constant in `minAmountLD`, so it must reach the pool as the
  // owner meant it: on a Stargate send, in units both legs share.
  const requireStargateFloor = (
    leg: Leg,
    minAmount: bigint,
    reached: readonly Leg[],
  ) => {
    if (minAmount <= 0n) {
      throw new SettlementLayerRefusal(
        'crossChainPermits: an LZ `to.minAmount` must be positive',
        { code: 'MIN_AMOUNT_NOT_POSITIVE', chainId: leg.chainId, leg: 'to' },
      )
    }
    // Stargate casts `minAmountLD` in shared decimals to uint64; a larger floor
    // would revert every send.
    if (minAmount > maxUint64) {
      throw new SettlementLayerRefusal(
        'crossChainPermits: an LZ `to.minAmount` above uint64 cannot be met by any Stargate send',
        { code: 'MIN_AMOUNT_ABOVE_UINT64', chainId: leg.chainId, leg: 'to' },
      )
    }
    // Legs are ORed, so a second leg into the chain would admit the send
    // without this floor.
    if (
      reached.some((other) => other !== leg && other.chainId === leg.chainId)
    ) {
      throw new SettlementLayerRefusal(
        `crossChainPermits: a floored LZ leg must be the only \`to\` leg on chain ${leg.chainId}; give one \`to\` leg per chain`,
        { code: 'LZ_FLOORED_LEG_NOT_ALONE', chainId: leg.chainId, leg: 'to' },
      )
    }
    // depositForBurn takes a maxFee, not a minimum out, so no word carries it.
    if (cctpReaches(leg)) {
      throw new SettlementLayerRefusal(
        `crossChainPermits: LZ pins \`to.minAmount\` only on a Stargate send, and chain ${leg.chainId} is reached over CCTP`,
        { code: 'LZ_FLOOR_ON_CCTP_ROUTE', chainId: leg.chainId, leg: 'to' },
      )
    }
    // Stargate reads `minAmountLD` in source units and pays out in destination
    // units; only equal decimals keep the floor in the `to` token's units.
    const from = decimals(ctx.chainId, token)
    const to = decimals(leg.chainId, leg.token)
    if (from === undefined || to === undefined || from !== to) {
      throw new SettlementLayerRefusal(
        `crossChainPermits: an LZ \`to.minAmount\` needs the \`from\` and \`to\` tokens served with equal decimals; chain ${ctx.chainId} serves ${from ?? 'none'}, chain ${leg.chainId} ${to ?? 'none'}`,
        { code: 'FLOOR_DECIMALS_MISMATCH', chainId: leg.chainId, leg: 'to' },
      )
    }
  }
  const stargate = source.stargateUsdc
  if (stargate !== undefined && isAddressEqual(token, stargate.token)) {
    const send: NestedCall = {
      target: stargate.pool,
      selector: OFT_SEND_SELECTOR,
      length: 484,
      args: (at) => [
        pinValue(at(SEND.sendParamPointer), 0x80n),
        // The fee is native only; the refund returns to LZMultiCall, whose
        // sweep forwards it to the account.
        pinValue(at(SEND.lzTokenFee), 0n),
        pin(at(SEND.refundAddress), multiCall),
        // A zero-amount send still costs the account the LayerZero fee.
        {
          condition: 'greaterThan',
          calldataOffset: at(SEND.amountLD),
          referenceValue: 0n,
        },
        pinValue(at(SEND.extraOptionsPointer), 0xe0n),
      ],
    }
    const calls = [pull, approve(stargate.pool), send, sweep]
    const { rules, args } = batch(calls)
    const s = args[2]
    // TAXI: extraOptions 0x0003, composeMsg and oftCmd empty. No native drop,
    // no compose.
    rules.push(
      pinValue(s(SEND.composeMsgPointer), 0x120n),
      pinValue(s(SEND.oftCmdPointer), 0x140n),
      pinValue(s(0x160n), 2n),
      pinValue(s(0x180n), 0x0003n << 240n),
      pinValue(s(0x1a0n), 0n),
      pinValue(s(0x1c0n), 0n),
    )
    const reaches = (leg: Leg) =>
      crossChain(leg) &&
      servedLz(leg)?.stargateUsdc !== undefined &&
      !cctpReaches(leg)
    routes.push({
      rules,
      calls: calls.length,
      reaches,
      leg: (leg) => {
        const dst = servedLz(leg)?.stargateUsdc
        if (!reaches(leg) || !dst || !isAddressEqual(leg.token, dst.token))
          return undefined
        return [
          pinValue(s(SEND.dstEid), BigInt(dst.eid)),
          ...recipient(s(SEND.to), leg),
          ...(leg.minAmount === undefined
            ? []
            : [atLeast(s(SEND.minAmountLD), leg.minAmount)]),
        ]
      },
      pull: args[0](96n),
      limits: [],
    })
  }
  if (cctpFrom) {
    const burn: NestedCall = {
      target: LZ_CCTP_TOKEN_MESSENGER,
      selector: DEPOSIT_FOR_BURN,
      length: 228,
      // `burnToken` is not pinned: the pull and the sweep are pinned to this
      // token and the account, so another burn token can only spend what a
      // third party left in LZMultiCall, and the pull is swept back.
      args: (at) => [
        // A non-zero destinationCaller restricts who may mint; the API never
        // sets one.
        pinValue(at(128n), 0n),
      ],
    }
    const fee: NestedCall = {
      target: token,
      selector: TRANSFER,
      length: 68,
      args: (at) => [pin(at(0n), cctp.feeReceiver)],
    }
    const maxFee =
      ctx.cap !== undefined && ctx.cap < LZ_CCTP_MAX_RELAY_FEE
        ? ctx.cap
        : LZ_CCTP_MAX_RELAY_FEE
    for (const feeless of [false, true]) {
      const calls = feeless
        ? [pull, approve(LZ_CCTP_TOKEN_MESSENGER), burn, sweep]
        : [pull, fee, approve(LZ_CCTP_TOKEN_MESSENGER), burn, sweep]
      const { rules, args } = batch(calls)
      const b = args[calls.indexOf(burn)]
      const reaches = (leg: Leg) =>
        cctpLinks(leg) && (servedLz(leg)?.cctp?.feeless === true) === feeless
      routes.push({
        rules,
        calls: calls.length,
        reaches,
        leg: (leg) => {
          const dst = servedLz(leg)?.cctp
          if (!reaches(leg) || !dst || !isAddressEqual(leg.token, dst.token))
            return undefined
          return [
            pinValue(b(32n), BigInt(dst.domain)),
            ...recipient(b(64n), leg),
          ]
        },
        pull: args[0](96n),
        limits: [
          // The fee goes to LayerZero's receiver, so the key cannot keep it;
          // the ceiling bounds how much of the pull it can waste there. On a
          // reusable session it is a lifetime total (about 10 sends into
          // Ethereum), after which the fee route is refused.
          ...(feeless ? [] : [cumulativeCap(args[1](32n), maxFee)]),
        ],
      })
    }
  }
  if (routes.length === 0) {
    throw new SettlementLayerRefusal(
      `crossChainPermits: LZ moves only USDC; the \`from\` token on chain ${ctx.chainId} is ${token}`,
      { code: 'TOKEN_NOT_ROUTED', chainId: ctx.chainId, leg: 'from' },
    )
  }

  // A leg no route from this chain reaches is another chain's business in a
  // multi-chain permit; one it reaches with a token no route delivers is an error.
  const legs = ctx.destinations.filter((leg) =>
    routes.some((route) => route.reaches(leg)),
  )
  for (const leg of legs) {
    if (routes.every((route) => route.leg(leg) === undefined)) {
      throw new SettlementLayerRefusal(
        `crossChainPermits: LZ delivers only USDC; the \`to\` token on chain ${leg.chainId} is ${leg.token}`,
        { code: 'TOKEN_NOT_ROUTED', chainId: leg.chainId, leg: 'to' },
      )
    }
    if (leg.minAmount !== undefined)
      requireStargateFloor(leg, leg.minAmount, legs)
  }
  // Once per session, each route counts its own pull. A reusable session counts
  // every route's pull on one rule after the OR (below): per-route counters
  // would let a stale TransferDelegate allowance fund maxAmount per route.
  const reusable = ctx.reusable === true
  const branches = routes.flatMap((route) => {
    const pinned = legs.flatMap((leg) => {
      const rules = route.leg(leg)
      return rules ? [rules] : []
    })
    if (pinned.length === 0) return []
    const limits = reusable
      ? route.limits
      : [...cap(route.pull), ...route.limits]
    return [
      {
        route,
        rest: [
          anyOf(pinned.map(allOf)),
          ...(limits.length ? [allOf(limits)] : []),
        ],
      },
    ]
  })
  if (branches.length === 0) {
    throw new SettlementLayerRefusal(
      `crossChainPermits: LZ has no route from chain ${ctx.chainId} to any \`to\` chain`,
      { code: 'LZ_NO_ROUTE', chainId: ctx.chainId },
    )
  }
  // A pure pin that every branch of a group carries (`group.every`) is checked
  // once, ahead of their OR; that alone makes it sound. Grouping by call count
  // only picks the batches likely to share pins.
  const groups = [...new Set(branches.map(({ route }) => route.calls))].map(
    (calls) => {
      const group = branches.filter(({ route }) => route.calls === calls)
      const shared = group[0].route.rules.filter((rule) =>
        group.every(({ route }) => route.rules.some((r) => sameRule(r, rule))),
      )
      const own = group.map(({ route, rest }) => {
        const left = route.rules.filter(
          (r) => !shared.some((s) => sameRule(s, r)),
        )
        return and([...(left.length ? [allOf(left)] : []), ...rest])
      })
      return and([...(shared.length ? [allOf(shared)] : []), anyOf(own)])
    },
  )
  // The pulled amount sits at one offset per batch shape, so one rule counts
  // every route only when they share a shape.
  if (reusable && ctx.cap !== undefined && groups.length > 1) {
    throw new SettlementLayerRefusal(
      `crossChainPermits: an LZ permit without oneTimeUse caps one batch shape, and the \`to\` legs from chain ${ctx.chainId} need ${groups.length}; give them separate sessions, or set oneTimeUse`,
      { code: 'LZ_REUSABLE_ROUTES_SPLIT', chainId: ctx.chainId },
    )
  }
  const pullCap = reusable ? cap(branches[0].route.pull) : []
  const routed = and([
    anyOf(groups),
    ...(pullCap.length ? [allOf(pullCap)] : []),
  ])
  return {
    target: multiCall,
    selector: LZ_EXECUTE_SELECTOR,
    policies: [
      {
        type: 'arg-policy',
        // `msg.value` carries the Stargate messaging fee; the sweep returns any
        // overpayment to the account.
        valueLimitPerUse: maxUint256,
        expression: {
          type: 'and',
          // A usage limit on the shared calls pointer: one execute per session,
          // so a stale TransferDelegate allowance cannot fund a second route.
          // A reusable session bounds the pulls with one cap and the fees with
          // its maxNativeFee instead.
          left: allOf([
            reusable
              ? pinValue(0n, 0x40n)
              : { ...pinValue(0n, 0x40n), usageLimit: 0x40n },
          ]),
          right: routed,
        },
      },
    ],
  }
}
