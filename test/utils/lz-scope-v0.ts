// Frozen copy of `scopeLz` before RHI-8045 shrank its policy. The differential
// test in lz-policy-size.test.ts holds the live one to refuse all it refused,
// and pins this copy's compiled initData by hash, so a change to the live
// helpers it imports cannot move both sides together. Do not edit.
import {
  type Address,
  type Hex,
  isAddressEqual,
  maxUint256,
  pad,
  toFunctionSelector,
} from 'viem'
import {
  OFT_SEND_SELECTOR,
  SEND,
} from '../../src/modules/validators/smart-sessions/settlement/oft'
import { served } from '../../src/modules/validators/smart-sessions/settlement/served'
import type { SettlementContext } from '../../src/modules/validators/smart-sessions/settlement/types'
import {
  allOf,
  anyOf,
  cumulativeCap,
  pin,
  pinValue,
  pinWord,
} from '../../src/modules/validators/smart-sessions/swap/rules'
import type {
  ArgPolicyExpression,
  ScopedAction,
  UniversalActionPolicyParamRule,
} from '../../src/modules/validators/smart-sessions/types'

/**
 * LZ — USDC over the LayerZero Value Transfer API. The orchestrator forwards the
 * API's two steps: `approve(TransferDelegate)` and `LZMultiCall.execute(calls,
 * quoteId)`, whose nested calls pull the tokens, bridge them and sweep the rest
 * back. LZMultiCall runs any call it is handed, so every nested call is pinned:
 * the array length, each element offset, target, data pointer and
 * length-plus-selector, and each argument the key could redirect. The API picks
 * one of three routes, so the policy accepts exactly these layouts:
 *
 * - Stargate TAXI or BUS: delegateTransferFrom, approve(pool), pool.send, sweep.
 * - CCTP: delegateTransferFrom, transfer(fee), approve(TokenMessengerV2),
 *   depositForBurn, sweep; to Plasma without the fee transfer.
 */

/**
 * Circle's TokenMessengerV2, which the API's CCTP route approves and burns
 * through on every mainnet. `/chains` does not serve it inside `lz.cctp`, and
 * Plasma has no `cctp` block to borrow it from.
 */
const LZ_CCTP_TOKEN_MESSENGER: Address =
  '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'

/**
 * The most relay fee the key may send LayerZero's receiver, in USDC units: ~10x
 * the live fee into Ethereum (0.098 USDC), the dearest destination.
 */
const LZ_CCTP_MAX_RELAY_FEE = 1_000_000n

const LZ_EXECUTE_SELECTOR = toFunctionSelector(
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
  /** The send carries the messaging fee; every other call carries none. */
  readonly payable?: boolean
  readonly args: (at: At) => Rule[]
}

const ceil32 = (n: number) => BigInt(Math.ceil(n / 32) * 32)

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
    rules.push(
      pinValue(0x60n + BigInt(i) * 32n, relative),
      pin(start, call.target),
      ...(call.payable ? [] : [pinValue(start + 32n, 0n)]),
      pinValue(start + 64n, 0x60n),
      // The word ending at the selector: the length's low 28 bytes, then the
      // selector. A length above 2^224 fails to decode, so this pins both.
      pinValue(
        data - 28n,
        (BigInt(call.length) << 32n) | BigInt(call.selector),
      ),
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
  /** Only for Stargate: TAXI or BUS. */
  readonly modes?: Rule[][]
  /** Pins a leg this route delivers; undefined for one it cannot. */
  readonly leg: (leg: Leg) => Rule[] | undefined
  /** Whether this route reaches the leg's chain at all, whatever its token. */
  readonly reaches: (leg: Leg) => boolean
  /**
   * Usage-limited rules, evaluated last: a passing limited rule counts even if
   * its branch then fails.
   */
  readonly limits: Rule[]
}

/** The execute call, pinned to the permit's destinations, recipients and cap. */
export function scopeLzV0(ctx: SettlementContext): ScopedAction {
  if (ctx.sourceTokens.length !== 1) {
    throw new Error(
      'crossChainPermits: LZ moves one token (USDC) per chain; give exactly one `from` token on this chain',
    )
  }
  const account = ctx.account
  if (!account) {
    throw new Error(
      'crossChainPermits: LZ sweeps what it does not bridge back to the account, so the session definition needs `account`',
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

  const pull: NestedCall = {
    target: transferDelegate,
    selector: DELEGATE_TRANSFER_FROM,
    length: 132,
    args: (at) => [
      pin(at(0n), token),
      pin(at(32n), account),
      pin(at(64n), multiCall),
    ],
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
  const stargate = source.stargateUsdc
  if (stargate !== undefined && isAddressEqual(token, stargate.token)) {
    const send: NestedCall = {
      target: stargate.pool,
      selector: OFT_SEND_SELECTOR,
      length: 484,
      payable: true,
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
    // TAXI: extraOptions 0x0003, composeMsg and oftCmd empty. BUS: extraOptions
    // and composeMsg empty, oftCmd 0x01. No native drop, no compose.
    const taxi = [
      pinValue(s(SEND.composeMsgPointer), 0x120n),
      pinValue(s(SEND.oftCmdPointer), 0x140n),
      pinValue(s(0x160n), 2n),
      pinValue(s(0x180n), 0x0003n << 240n),
      pinValue(s(0x1a0n), 0n),
      pinValue(s(0x1c0n), 0n),
    ]
    const bus = [
      pinValue(s(SEND.composeMsgPointer), 0x100n),
      pinValue(s(SEND.oftCmdPointer), 0x120n),
      pinValue(s(0x160n), 0n),
      pinValue(s(0x180n), 0n),
      pinValue(s(0x1a0n), 1n),
      pinValue(s(0x1c0n), 0x01n << 248n),
    ]
    const reaches = (leg: Leg) =>
      crossChain(leg) && servedLz(leg)?.stargateUsdc !== undefined
    routes.push({
      rules,
      modes: [taxi, bus],
      reaches,
      leg: (leg) => {
        const dst = servedLz(leg)?.stargateUsdc
        if (!reaches(leg) || !dst || !isAddressEqual(leg.token, dst.token))
          return undefined
        return [
          pinValue(s(SEND.dstEid), BigInt(dst.eid)),
          ...recipient(s(SEND.to), leg),
        ]
      },
      limits: cap(args[0](96n)),
    })
  }
  const cctp = source.cctp
  if (cctp !== undefined && isAddressEqual(token, cctp.token)) {
    const burn: NestedCall = {
      target: LZ_CCTP_TOKEN_MESSENGER,
      selector: DEPOSIT_FOR_BURN,
      length: 228,
      args: (at) => [
        pin(at(96n), token),
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
        crossChain(leg) &&
        servedLz(leg)?.cctp !== undefined &&
        (servedLz(leg)?.cctp?.feeless === true) === feeless
      routes.push({
        rules,
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
        limits: [
          ...cap(args[0](96n)),
          // The fee goes to LayerZero's receiver, so the key cannot keep it;
          // the ceiling bounds how much of the pull it can waste there.
          ...(feeless ? [] : [cumulativeCap(args[1](32n), maxFee)]),
        ],
      })
    }
  }
  if (routes.length === 0) {
    throw new Error(
      `crossChainPermits: LZ moves only USDC; the \`from\` token on chain ${ctx.chainId} is ${token}`,
    )
  }

  // A leg no route from this chain reaches is another chain's business in a
  // multi-chain permit; one it reaches with a token no route delivers is an error.
  const legs = ctx.destinations.filter((leg) =>
    routes.some((route) => route.reaches(leg)),
  )
  for (const leg of legs) {
    if (routes.every((route) => route.leg(leg) === undefined)) {
      throw new Error(
        `crossChainPermits: LZ delivers only USDC; the \`to\` token on chain ${leg.chainId} is ${leg.token}`,
      )
    }
  }
  const branches = routes.flatMap((route): ArgPolicyExpression[] => {
    const pinned = legs.flatMap((leg) => {
      const rules = route.leg(leg)
      return rules ? [rules] : []
    })
    if (pinned.length === 0) return []
    return [
      [
        allOf(route.rules),
        ...(route.modes ? [anyOf(route.modes.map(allOf))] : []),
        anyOf(pinned.map(allOf)),
        ...(route.limits.length ? [allOf(route.limits)] : []),
      ].reduceRight((right, left) => ({ type: 'and', left, right })),
    ]
  })
  if (branches.length === 0) {
    throw new Error(
      `crossChainPermits: LZ has no route from chain ${ctx.chainId} to any \`to\` chain`,
    )
  }
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
          // The calls pointer every route shares counts its own value against a
          // limit of that value: one execute per session, whatever the route.
          // The burning transaction admits every later op, so without it a
          // stale TransferDelegate allowance could fund a second route, and a
          // second Stargate send would pay another native fee.
          left: allOf([{ ...pinValue(0n, 0x40n), usageLimit: 0x40n }]),
          right: anyOf(branches),
        },
      },
    ],
  }
}
