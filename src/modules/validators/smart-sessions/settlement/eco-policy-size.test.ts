import {
  type Address,
  concat,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  hexToBigInt,
  maxUint256,
  pad,
  size,
  slice,
  toFunctionSelector,
  toHex,
} from 'viem'
import { arbitrum, base, mainnet, optimism } from 'viem/chains'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import {
  ECO_ACCOUNT,
  ECO_PORTAL,
  publish,
  routeAbi,
} from '../../../../../test/utils/eco-publish'
import {
  type RuleUsage,
  satisfiesRules,
} from '../../../../../test/utils/policy-rules'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { encodeSessionPolicy } from '../policies/encode'
import { allOf, pin, pinValue, pinWord } from '../swap/rules'
import type {
  ArgPolicyExpression,
  ScopedAction,
  UniversalActionPolicyParamRule,
} from '../types'
import {
  PUBLISH,
  PUBLISH_AND_FUND_SELECTOR,
  proversBetween,
  scopeEco,
} from './eco'
import { served } from './served'
import type { SettlementContext } from './types'

/**
 * Enabling a session stores every action policy's config, and the cost tracks
 * the non-zero slots written. This file guards the ECO_IE publish policy's size
 * reduction: a frozen copy of the policy as it stood before it, and a
 * differential that every valid call is still admitted and every mutation the
 * old policy refused is still refused, unless no solver can ever fill it.
 */

const NOW = 1_800_000_000n
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Number(NOW * 1000n))
})
afterAll(() => {
  vi.useRealTimers()
})

const stablecoins = (chainId: number) =>
  SETTLEMENT_CATALOG[chainId].eco!.stablecoins
const USDC_BASE = stablecoins(base.id)[0]
const USDC_ARB = stablecoins(arbitrum.id)[0]
const USDC_OP = stablecoins(optimism.id)[0]
const USDC_ETH = stablecoins(mainnet.id)[0]
const ATTACKER = '0x2222222222222222222222222222222222222222' as Address
const POLYMER_PROVER = '0xE3e4e6F284f1c8E17bafE4268EB98c36886B4d8B' as Address
const CCIP_PROVER = '0xceBB7cDDBA4734C7130BF114a37C2dA4C5f3c473' as Address
const TRANSFER_SELECTOR = toFunctionSelector('transfer(address,uint256)')

/** `scopeEco`'s policy before the size reduction, kept verbatim as the baseline. */
function legacyEco(ctx: SettlementContext): ScopedAction {
  const cap = ctx.cap!
  const feeBps = BigInt(ctx.maxFeeBps!)
  const floor = (cap * (10_000n - feeBps) + 10_000n - 1n) / 10_000n
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
    pin(PUBLISH.rewardCreator, ctx.account!),
    pinValue(PUBLISH.rewardNativeAmount, 0n),
    pinValue(PUBLISH.rewardTokensPointer, 0xa0n),
    pinValue(PUBLISH.rewardTokensLength, 1n),
    pin(PUBLISH.rewardToken, ctx.sourceTokens[0]),
    {
      condition: 'lessThanOrEqual',
      calldataOffset: PUBLISH.rewardAmount,
      referenceValue: cap,
      usageLimit: cap,
    },
    {
      condition: 'lessThanOrEqual',
      calldataOffset: PUBLISH.rewardDeadline,
      referenceValue: ctx.validUntil!,
    },
    {
      condition: 'lessThanOrEqual',
      calldataOffset: PUBLISH.routeDeadline,
      referenceValue: ctx.validUntil!,
    },
  ]
  const legs = ctx.destinations.map((leg): ArgPolicyExpression => {
    const recipient = leg.recipient!
    const legRules: UniversalActionPolicyParamRule[] = [
      pinValue(PUBLISH.destination, BigInt(leg.chainId)),
      pin(
        PUBLISH.routePortal,
        served(ctx.settlement, leg.chainId, 'eco').portal,
      ),
      pin(PUBLISH.routeToken, leg.token),
      pin(PUBLISH.callTarget, leg.token),
      pinWord(
        PUBLISH.callDataHead,
        concat([TRANSFER_SELECTOR, slice(pad(recipient), 0, 28)]),
      ),
      pinWord(PUBLISH.transferRecipient, pad(recipient)),
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
    const provers = proversBetween(ctx.settlement, ctx.chainId, leg.chainId)
    return {
      type: 'and',
      left: allOf(legRules),
      right: provers
        .map((p): ArgPolicyExpression => allOf([pin(PUBLISH.rewardProver, p)]))
        .reduce((left, right) => ({ type: 'or', left, right })),
    }
  })
  return {
    target: ctx.target,
    selector: PUBLISH_AND_FUND_SELECTOR,
    policies: [
      {
        type: 'arg-policy',
        valueLimitPerUse: 0n,
        expression: {
          type: 'and',
          left: allOf(rules),
          right: legs.reduce((left, right) => ({ type: 'or', left, right })),
        },
      },
      ...ctx.timeFrame,
    ],
  }
}

/** Every rule in an expression, OR branches included. */
const rulesOf = (e: ArgPolicyExpression): UniversalActionPolicyParamRule[] =>
  e.type === 'rule'
    ? [e.rule]
    : e.type === 'not'
      ? rulesOf(e.child)
      : [...rulesOf(e.left), ...rulesOf(e.right)]

/** What the chain admits: the action id binds the selector, the policy the args. */
function accepts(action: ScopedAction, calldata: Hex, usage?: RuleUsage) {
  return (
    slice(calldata, 0, 4) === action.selector &&
    satisfiesRules(action, calldata, usage)
  )
}

/** Overwrite the 32 bytes at an args offset. */
function rewrite(calldata: Hex, offset: bigint, value: bigint): Hex {
  const at = 4 + Number(offset)
  return concat([
    slice(calldata, 0, at),
    pad(toHex(value & maxUint256), { size: 32 }),
    ...(at + 32 < size(calldata) ? [slice(calldata, at + 32)] : []),
  ])
}

/** The ecrecover precompile: code-less on every EVM chain. */
const ECRECOVER = '0x0000000000000000000000000000000000000001'

/** Every Eco stablecoin a leg can deliver; each one's `transfer` is non-payable. */
const NON_PAYABLE_TOKENS = new Set(
  Object.values(SETTLEMENT_CATALOG).flatMap((block) =>
    (block.eco?.stablecoins ?? []).map((t) => t.toLowerCase()),
  ),
)

/**
 * Whether the destination Portal reverts every fill of a canonical route.
 * `_fulfill` pulls each route token with OZ 5.0 `safeTransferFrom`, which
 * reverts on a target with no code, and `Executor` bubbles a failed call, which
 * a non-payable `transfer` sent value always is.
 */
function fillReverts(
  route: ReturnType<typeof decodeAbiParameters<typeof routeAbi>>[0],
) {
  return (
    route.tokens.some((t) => t.token.toLowerCase() === ECRECOVER) ||
    route.calls.some(
      (c) => c.value !== 0n && NON_PAYABLE_TOKENS.has(c.target.toLowerCase()),
    )
  )
}

/**
 * Whether no solver can ever fill the publish. The source hashes the route
 * bytes as given, the destination re-encodes the decoded `Route`, so a route
 * that is not the canonical encoding of any `Route` never matches, and a
 * canonical one whose fill reverts never lands either. Its reward only refunds
 * to the pinned creator after the pinned deadline — what a route deadline in
 * the past, which the policy has always admitted, already does.
 */
function unfillable(calldata: Hex): boolean {
  const args = slice(calldata, 4)
  const end = BigInt(size(args))
  const word = (at: bigint) =>
    hexToBigInt(slice(args, Number(at), Number(at) + 32))
  const pointer = word(32n)
  // Out of bounds: the source decoder reverts.
  if (pointer + 32n > end) return true
  const length = word(pointer)
  if (pointer + 32n + length > end) return true
  const route =
    length === 0n
      ? '0x'
      : slice(args, Number(pointer) + 32, Number(pointer + 32n + length))
  try {
    const [decoded] = decodeAbiParameters(routeAbi, route)
    return (
      encodeAbiParameters(routeAbi, [decoded]) !== route.toLowerCase() ||
      fillReverts(decoded)
    )
  } catch {
    return true
  }
}

/**
 * Each valid call is admitted by both; each one-word mutation (every args word,
 * every rule offset, and the selector; +1, 0, an attacker address), each
 * multi-word `rewrites` of it, and each re-encoded alternative the old policy
 * refused is refused by the new one, unless `harmless` says why not.
 */
function expectNoWidening(
  legacy: ScopedAction,
  current: ScopedAction,
  valid: readonly Hex[],
  alternatives: readonly Hex[],
  rewrites: readonly ((calldata: Hex) => Hex)[],
  harmless: (calldata: Hex) => boolean,
) {
  const legacyOffsets = (legacy.policies ?? []).flatMap((p) =>
    p.type === 'arg-policy'
      ? rulesOf(p.expression).map((r) => r.calldataOffset)
      : [],
  )
  let refusedByBoth = 0
  const check = (mutant: Hex) => {
    if (accepts(legacy, mutant)) return
    if (accepts(current, mutant)) {
      expect(harmless(mutant), `widened: ${mutant}`).toBe(true)
    } else {
      refusedByBoth++
    }
  }
  for (const calldata of alternatives) check(calldata)
  for (const calldata of valid) {
    expect(harmless(calldata), 'a valid call is not harmless').toBe(false)
    expect(accepts(legacy, calldata), 'legacy admits').toBe(true)
    expect(accepts(current, calldata), 'current admits').toBe(true)
    const words = Array.from(
      { length: Math.floor((size(calldata) - 4) / 32) },
      (_, i) => BigInt(i * 32),
    )
    const mutants = [
      concat(['0xdeadbeef', slice(calldata, 4)]),
      ...rewrites.map((r) => r(calldata)),
      ...[...new Set([...words, ...legacyOffsets])].flatMap((offset) => {
        const at = 4 + Number(offset)
        const was = hexToBigInt(slice(calldata, at, at + 32))
        return [was + 1n, 0n, hexToBigInt(ATTACKER)].map((value) =>
          rewrite(calldata, offset, value),
        )
      }),
    ]
    for (const mutant of mutants) if (mutant !== calldata) check(mutant)
  }
  return refusedByBoth
}

/**
 * The route moved past the reward and re-pointed to an attacker, the pinned
 * words left behind as a decoy: only the route pointer pin refuses it.
 */
function relocatedRoute(calldata: Hex): Hex {
  const args = slice(calldata, 4)
  const length = hexToBigInt(slice(args, 0x80, 0xa0))
  const [route] = decodeAbiParameters(
    routeAbi,
    slice(args, 0xa0, 0xa0 + Number(length)),
  )
  const stolen = encodeAbiParameters(routeAbi, [
    {
      ...route,
      calls: [
        {
          ...route.calls[0],
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [ATTACKER, route.tokens[0].amount],
          }),
        },
      ],
    },
  ])
  return concat([
    rewrite(calldata, PUBLISH.routePointer, BigInt(size(args))),
    pad(toHex(size(stolen))),
    stolen,
  ])
}

/**
 * A canonical route with no calls, ending before the pinned call words so they
 * are a decoy in the gap: the solver is paid and nothing is delivered. Only the
 * call count pin refuses it once the route length is not pinned.
 */
const emptiedCalls = (calldata: Hex): Hex =>
  rewrite(
    rewrite(calldata, PUBLISH.routeLength, 0x160n),
    PUBLISH.callsLength,
    0n,
  )

/**
 * The route re-declared with `n` tokens and laid out canonically around it:
 * the calls pointer after the tokens, the route ending at a zero call count.
 * With 3 tokens it is canonical, its second token is the pinned call count
 * (address 1) and the call count is the pinned call value; other counts land
 * the call count on a pinned non-zero word or a token on the transfer head.
 */
const tokenCount =
  (n: bigint) =>
  (calldata: Hex): Hex =>
    rewrite(
      rewrite(
        rewrite(calldata, PUBLISH.routeTokensLength, n),
        PUBLISH.routeCallsPointer,
        0xe0n + 0x40n * n,
      ),
      PUBLISH.routeLength,
      0x120n + 0x40n * n,
    )

/**
 * No tokens and no calls: the call count lands on the route token word, so
 * only the route token pin keeps this canonical, deliver-nothing route out.
 */
const noTokensNoCalls = (calldata: Hex): Hex =>
  rewrite(tokenCount(0n)(calldata), PUBLISH.routeToken, 0n)

const ruleComponents = [
  { name: 'condition', type: 'uint8' },
  { name: 'offset', type: 'uint64' },
  { name: 'isLimited', type: 'bool' },
  { name: 'ref', type: 'bytes32' },
  {
    name: 'usage',
    type: 'tuple',
    components: [
      { name: 'limit', type: 'uint256' },
      { name: 'used', type: 'uint256' },
    ],
  },
] as const

/**
 * The storage slots an ArgPolicy writes on enable, as its `fill` writes them:
 * a rule is 4 slots (condition/offset/isLimited packed, ref, limit, used), plus
 * the root index, both array lengths and a slot per tree node.
 */
function storageSlots(action: ScopedAction) {
  const policy = action.policies?.find((p) => p.type === 'arg-policy')
  if (!policy) throw new Error('expected an arg policy')
  const [config] = decodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'valueLimitPerUse', type: 'uint256' },
          {
            name: 'paramRules',
            type: 'tuple',
            components: [
              { name: 'rootNodeIndex', type: 'uint8' },
              { name: 'rules', type: 'tuple[]', components: ruleComponents },
              { name: 'packedNodes', type: 'uint256[]' },
            ],
          },
        ],
      },
    ],
    encodeSessionPolicy(policy, 'production').initData,
  )
  const { rootNodeIndex, rules, packedNodes } = config.paramRules
  const slots = [
    config.valueLimitPerUse,
    BigInt(rootNodeIndex),
    BigInt(rules.length),
    // OR-ed rather than packed: only whether the slot is zero matters.
    ...rules.flatMap((r) => [
      BigInt(r.condition) | r.offset | (r.isLimited ? 1n : 0n),
      hexToBigInt(r.ref),
      r.usage.limit,
      r.usage.used,
    ]),
    BigInt(packedNodes.length),
    ...packedNodes,
  ]
  const nonZero = slots.filter((s) => s !== 0n).length
  return { nonZero, zero: slots.length - nonZero }
}

const ecoCtx: SettlementContext = {
  chainId: base.id,
  settlement: SETTLEMENT_CATALOG,
  target: ECO_PORTAL,
  account: ECO_ACCOUNT,
  sourceTokens: [USDC_BASE],
  destinations: [
    { chainId: arbitrum.id, token: USDC_ARB, recipient: ECO_ACCOUNT },
  ],
  cap: 100n,
  maxFeeBps: 100,
  validUntil: 1_900_000_000n,
  timeFrame: [],
}

const legsCtx = (destinations: SettlementContext['destinations']) => ({
  ...ecoCtx,
  destinations,
})

describe('ECO_IE publishAndFund', () => {
  const cases: readonly {
    readonly name: string
    readonly ctx: SettlementContext
    readonly valid: readonly Hex[]
  }[] = [
    {
      name: 'one leg, Base to Arbitrum',
      ctx: ecoCtx,
      valid: [
        publish(),
        publish({ prover: POLYMER_PROVER }),
        publish({ delivered: 100n, reward: 50n }),
        // Already unfillable and admitted before: the baseline a non-canonical
        // route is held to.
        publish({ routeDeadline: 0n }),
      ],
    },
    {
      name: 'a 50 bps floor',
      ctx: { ...ecoCtx, maxFeeBps: 50 },
      valid: [publish({ delivered: 100n })],
    },
    {
      name: 'two legs with their own recipients, sharing a prover set',
      ctx: legsCtx([
        { chainId: arbitrum.id, token: USDC_ARB, recipient: ECO_ACCOUNT },
        { chainId: optimism.id, token: USDC_OP, recipient: ATTACKER },
      ]),
      valid: [
        publish(),
        publish({
          destination: 10n,
          routeToken: USDC_OP,
          recipient: ATTACKER,
        }),
      ],
    },
    {
      name: 'two legs sharing the recipient, with their own prover sets',
      ctx: legsCtx([
        { chainId: arbitrum.id, token: USDC_ARB, recipient: ECO_ACCOUNT },
        { chainId: mainnet.id, token: USDC_ETH, recipient: ECO_ACCOUNT },
      ]),
      valid: [
        publish(),
        publish({ destination: 1n, routeToken: USDC_ETH }),
        publish({ destination: 1n, routeToken: USDC_ETH, prover: CCIP_PROVER }),
      ],
    },
    {
      // The same word at different offsets in different legs: hoisting it
      // by value alone would pin one leg's recipient onto the other.
      name: "one leg's recipient is another leg's token",
      ctx: legsCtx([
        { chainId: arbitrum.id, token: USDC_ARB, recipient: USDC_OP },
        { chainId: optimism.id, token: USDC_OP, recipient: ECO_ACCOUNT },
      ]),
      valid: [
        publish({ recipient: USDC_OP }),
        publish({ destination: 10n, routeToken: USDC_OP }),
      ],
    },
    {
      name: 'Ronin to Base, one prover',
      ctx: {
        ...ecoCtx,
        chainId: 2020,
        target: SETTLEMENT_CATALOG[2020].eco!.portal,
        sourceTokens: [stablecoins(2020)[0]],
        destinations: [
          { chainId: base.id, token: USDC_BASE, recipient: ECO_ACCOUNT },
        ],
      },
      valid: [
        publish({
          destination: 8453n,
          routeToken: USDC_BASE,
          rewardToken: stablecoins(2020)[0],
          prover: CCIP_PROVER,
        }),
      ],
    },
  ]
  const ctxOf = (name: string) => {
    const found = cases.find((c) => c.name === name)
    if (!found) throw new Error(`no case ${name}`)
    return found.ctx
  }

  /** Canonical publishes the existing tests refuse, one field changed each. */
  const alternatives = [
    publish({ recipient: ATTACKER }),
    publish({
      callData: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [ECO_ACCOUNT, 99n],
      }),
    }),
    publish({ destination: 10n }),
    publish({ portal: ATTACKER }),
    publish({ callTarget: ATTACKER }),
    publish({ routeNative: 1n }),
    publish({ prover: ATTACKER }),
    publish({ creator: ATTACKER }),
    publish({ rewardToken: USDC_OP }),
    publish({ reward: 101n }),
    publish({ rewardNative: 1n }),
    publish({ deadline: 1_900_000_001n }),
    publish({ routeDeadline: 1_900_000_001n }),
    publish({ allowPartial: true }),
    publish({ extraCall: true }),
    publish({ extraToken: true }),
    publish({ delivered: 98n }),
    publish({ delivered: 98n, reward: 99n }),
  ]

  test.each(cases)('$name: no one-word mutation widens', ({ ctx, valid }) => {
    const refusedByBoth = expectNoWidening(
      legacyEco(ctx),
      scopeEco(ctx),
      valid,
      alternatives,
      [
        relocatedRoute,
        emptiedCalls,
        noTokensNoCalls,
        ...[0n, 2n, 3n, 4n, 5n, 6n, 7n].map(tokenCount),
      ],
      unfillable,
    )
    expect(refusedByBoth).toBeGreaterThan(0)
  })

  test.each([
    [
      'two legs with their own recipients, sharing a prover set',
      [
        publish({ destination: 10n, routeToken: USDC_OP }),
        publish({ recipient: ATTACKER }),
        publish({ destination: 10n, recipient: ATTACKER }),
      ],
    ],
    [
      "one leg's recipient is another leg's token",
      [
        publish({ destination: 10n, routeToken: USDC_OP, recipient: USDC_OP }),
        publish({ routeToken: USDC_OP, recipient: USDC_OP }),
        publish(),
      ],
    ],
  ] as const)(
    '%s: a leg is not satisfied by another leg’s fields',
    (name, crossed) => {
      const ctx = ctxOf(name)
      for (const calldata of crossed) {
        expect(accepts(legacyEco(ctx), calldata)).toBe(false)
        expect(accepts(scopeEco(ctx), calldata)).toBe(false)
      }
    },
  )

  test('a three-token route is canonical; only its precompile token stops the fill', () => {
    const calldata = tokenCount(3n)(publish())
    const args = slice(calldata, 4)
    const length = hexToBigInt(slice(args, 0x80, 0xa0))
    const route = slice(args, 0xa0, 0xa0 + Number(length))
    const [decoded] = decodeAbiParameters(routeAbi, route)
    expect(encodeAbiParameters(routeAbi, [decoded])).toBe(route.toLowerCase())
    expect(decoded.calls).toEqual([])
    expect(decoded.tokens[1].token.toLowerCase()).toBe(ECRECOVER)
    expect(fillReverts(decoded)).toBe(true)
  })

  test('the reward cap is cumulative in both', () => {
    for (const action of [legacyEco(ecoCtx), scopeEco(ecoCtx)]) {
      const usage: RuleUsage = new Map()
      expect(accepts(action, publish({ reward: 60n }), usage)).toBe(true)
      expect(accepts(action, publish({ reward: 50n }), usage)).toBe(false)
      expect(accepts(action, publish({ reward: 40n }), usage)).toBe(true)
      expect(accepts(action, publish({ reward: 1n }), usage)).toBe(false)
    }
  })

  test('the reward cap keeps one counter across legs', () => {
    const ctx = ctxOf(
      'two legs sharing the recipient, with their own prover sets',
    )
    for (const action of [legacyEco(ctx), scopeEco(ctx)]) {
      const usage: RuleUsage = new Map()
      expect(accepts(action, publish({ reward: 60n }), usage)).toBe(true)
      expect(
        accepts(
          action,
          publish({ reward: 50n, destination: 1n, routeToken: USDC_ETH }),
          usage,
        ),
      ).toBe(false)
    }
  })

  test('storage slots written on enable, before and after', () => {
    const twoLegs = ctxOf(
      'two legs sharing the recipient, with their own prover sets',
    )
    expect({
      oneLeg: {
        before: storageSlots(legacyEco(ecoCtx)),
        after: storageSlots(scopeEco(ecoCtx)),
      },
      twoLegs: {
        before: storageSlots(legacyEco(twoLegs)),
        after: storageSlots(scopeEco(twoLegs)),
      },
    }).toMatchInlineSnapshot(`
      {
        "oneLeg": {
          "after": {
            "nonZero": 94,
            "zero": 53,
          },
          "before": {
            "nonZero": 125,
            "zero": 70,
          },
        },
        "twoLegs": {
          "after": {
            "nonZero": 117,
            "zero": 66,
          },
          "before": {
            "nonZero": 168,
            "zero": 93,
          },
        },
      }
    `)
  })
})
