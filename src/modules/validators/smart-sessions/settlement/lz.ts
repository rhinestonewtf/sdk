import {
  type Address,
  type Hex,
  isAddressEqual,
  maxUint256,
  pad,
  toFunctionSelector,
} from 'viem'
import {
  allOf,
  anyOf,
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
import { CCTP_CHAINS, CCTP_TOKEN_MESSENGER_MAINNET } from './cctp'
import { OFT_SEND_SELECTOR, SEND } from './oft'
import type { SettlementContext } from './types'

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

/** Per chain: the API's LZMultiCall (the `execute` target) and its TransferDelegate. */
export const LZ_MULTICALL: Readonly<
  Record<
    number,
    { readonly multiCall: Address; readonly transferDelegate: Address }
  >
> = {
  1: {
    multiCall: '0xAcdDAC6C77318B615f7F6fB9bb67c6833e9c05f1',
    transferDelegate: '0x72fAEbF58A62e33C044c37D8D973a961633ea294',
  },
  10: {
    multiCall: '0x5528Cf58fEB8fbfcE94f43B33240FFFB1312bDe3',
    transferDelegate: '0xFBea79D13E6F795a0e1E4B99090f1165a01C7B03',
  },
  146: {
    multiCall: '0x6336eD39c2Eb15a8cFea73542600eFf31EA83353',
    transferDelegate: '0x420C2efa26c972308A543305217399ff65CbDb13',
  },
  8453: {
    multiCall: '0x7e07A9148E9149e430C6412b79A675028595Ff1f',
    transferDelegate: '0x8EcA03175fd5aC62fb6F4EcbB9A95D13dCDCB4F8',
  },
  ...Object.fromEntries(
    [130, 137, 143, 999, 1868, 9745, 42161, 43114, 57073].map((chainId) => [
      chainId,
      {
        multiCall: '0x8E60b7b64b63cD56b18ebcECADcb79B04919286e',
        transferDelegate: '0x60FccB9b58d5E806ca5Cb8BFCe721c2274609dE4',
      },
    ]),
  ),
}

/**
 * Stargate V2 USDC pools on chains whose registry USDC is the pool's token.
 * (Ink's pool moves USDC.e, which the orchestrator does not quote.)
 */
export const STARGATE_USDC: Readonly<
  Record<
    number,
    { readonly pool: Address; readonly token: Address; readonly eid: number }
  >
> = {
  1: {
    pool: '0xc026395860Db2d07ee33e05fE50ed7bD583189C7',
    token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    eid: 30101,
  },
  10: {
    pool: '0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0',
    token: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    eid: 30111,
  },
  137: {
    pool: '0x9Aa02D4Fae7F58b8E8f34c66E756cC734DAc7fe4',
    token: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    eid: 30109,
  },
  146: {
    pool: '0xA272fFe20cFfe769CdFc4b63088DCD2C82a2D8F9',
    token: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894',
    eid: 30332,
  },
  1868: {
    pool: '0x45f1A95A4D3f3836523F5c83673c797f4d4d263B',
    token: '0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369',
    eid: 30340,
  },
  8453: {
    pool: '0x27a16dc786820B16E5c9028b75B99F6f604b5d26',
    token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    eid: 30184,
  },
  42161: {
    pool: '0xe8CDF27AcD73a434D661C84887215F7598e7d0d3',
    token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    eid: 30110,
  },
  43114: {
    pool: '0x5634c4a5FEd09819E3c46D86A965Dd9447d86e47',
    token: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    eid: 30106,
  },
}

/** CCTP chains the API routes USDC between: the LZ chains CCTP knows, plus Plasma. */
const LZ_CCTP_CHAINS: Readonly<
  Record<number, { readonly domain: number; readonly usdc: Address }>
> = {
  ...Object.fromEntries(
    Object.keys(LZ_MULTICALL).flatMap((id) =>
      CCTP_CHAINS[Number(id)] ? [[id, CCTP_CHAINS[Number(id)]]] : [],
    ),
  ),
  9745: { domain: 33, usdc: '0x2d661C89D812261039AF9764eceaAee884f5F67F' },
}

/** Receives the API's CCTP relay fee on every source chain. */
export const LZ_CCTP_FEE_RECEIVER: Address =
  '0xB324De4ADd083B74856082Ed2EA0B8b6F3864827'

/** Destinations the API delivers CCTP to without a relay fee. */
const LZ_CCTP_FEELESS_DESTINATIONS: ReadonlySet<number> = new Set([9745])

/**
 * The most relay fee the key may send LayerZero's receiver, in USDC units: ~10x
 * the live fee into Ethereum (0.098 USDC), the dearest destination.
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

function lzChain(chainId: number) {
  const chain = LZ_MULTICALL[chainId]
  if (chain === undefined) {
    throw new Error(
      `crossChainPermits: LZ does not route from chain ${chainId}`,
    )
  }
  return chain
}

export function lzMultiCall(chainId: number): Address {
  return lzChain(chainId).multiCall
}

export function lzTransferDelegate(chainId: number): Address {
  return lzChain(chainId).transferDelegate
}

/** The execute call, pinned to the permit's destinations, recipients and cap. */
export function scopeLz(ctx: SettlementContext): ScopedAction {
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
  const { multiCall, transferDelegate } = lzChain(ctx.chainId)
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
  const stargate = STARGATE_USDC[ctx.chainId]
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
      crossChain(leg) && STARGATE_USDC[leg.chainId] !== undefined
    routes.push({
      rules,
      modes: [taxi, bus],
      reaches,
      leg: (leg) => {
        const dst = STARGATE_USDC[leg.chainId]
        if (!reaches(leg) || !isAddressEqual(leg.token, dst.token))
          return undefined
        return [
          pinValue(s(SEND.dstEid), BigInt(dst.eid)),
          ...recipient(s(SEND.to), leg),
        ]
      },
      limits: cap(args[0](96n)),
    })
  }
  const cctp = LZ_CCTP_CHAINS[ctx.chainId]
  if (cctp !== undefined && isAddressEqual(token, cctp.usdc)) {
    const burn: NestedCall = {
      target: CCTP_TOKEN_MESSENGER_MAINNET,
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
      args: (at) => [pin(at(0n), LZ_CCTP_FEE_RECEIVER)],
    }
    const maxFee =
      ctx.cap !== undefined && ctx.cap < LZ_CCTP_MAX_RELAY_FEE
        ? ctx.cap
        : LZ_CCTP_MAX_RELAY_FEE
    for (const feeless of [false, true]) {
      const calls = feeless
        ? [pull, approve(CCTP_TOKEN_MESSENGER_MAINNET), burn, sweep]
        : [pull, fee, approve(CCTP_TOKEN_MESSENGER_MAINNET), burn, sweep]
      const { rules, args } = batch(calls)
      const b = args[calls.indexOf(burn)]
      const reaches = (leg: Leg) =>
        crossChain(leg) &&
        LZ_CCTP_CHAINS[leg.chainId] !== undefined &&
        LZ_CCTP_FEELESS_DESTINATIONS.has(leg.chainId) === feeless
      routes.push({
        rules,
        reaches,
        leg: (leg) => {
          const dst = LZ_CCTP_CHAINS[leg.chainId]
          if (!reaches(leg) || !isAddressEqual(leg.token, dst.usdc))
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
      ...ctx.timeFrame,
    ],
  }
}
