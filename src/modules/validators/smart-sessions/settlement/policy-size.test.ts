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
import { arbitrum, base, mainnet, optimism, plasma } from 'viem/chains'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import {
  ECO_ACCOUNT,
  publish,
  routeAbi,
} from '../../../../../test/utils/eco-publish'
import {
  type RuleUsage,
  satisfiesRules,
} from '../../../../../test/utils/policy-rules'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { resolveCrossChainPermission } from '../cross-chain-permits'
import { encodeSessionPolicy } from '../policies/encode'
import { allOf, pin, pinValue, pinWord } from '../swap/rules'
import type {
  ArgPolicyExpression,
  CrossChainPermissionInput,
  ScopedAction,
  SessionPolicy,
  UniversalActionPolicyParamRule,
} from '../types'
import {
  PUBLISH,
  PUBLISH_AND_FUND_SELECTOR,
  proversBetween,
  scopeEco,
} from './eco'
import { resolveSettlementScope } from './scope'
import { served } from './served'
import type { SettlementContext } from './types'

/**
 * Enabling a session stores every action policy's config, and the cost tracks
 * the non-zero words written. This file guards the size reductions: a frozen
 * copy of each policy as it stood before them, and a differential that every
 * valid call is still admitted and every one-word mutation the old policy
 * refused is still refused.
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
const ECO_PORTAL = SETTLEMENT_CATALOG[base.id].eco!.portal
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

/** Every rule in a policy, OR branches included. */
function rulesOf(policy: SessionPolicy): UniversalActionPolicyParamRule[] {
  const walk = (e: ArgPolicyExpression): UniversalActionPolicyParamRule[] =>
    e.type === 'rule'
      ? [e.rule]
      : e.type === 'not'
        ? walk(e.child)
        : [...walk(e.left), ...walk(e.right)]
  return policy.type === 'arg-policy'
    ? walk(policy.expression)
    : policy.type === 'universal-action'
      ? [...policy.rules]
      : []
}

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

/**
 * Whether no solver can ever fill the publish. The source hashes the route
 * bytes as given, the destination re-encodes the decoded `Route`, so a route
 * that is not the canonical encoding of any `Route` never matches. Its reward
 * only refunds to the pinned creator after the pinned deadline — what a route
 * deadline in the past, which the policy has always admitted, already does.
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
    return encodeAbiParameters(routeAbi, [decoded]) !== route.toLowerCase()
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
    rulesOf(p).map((r) => r.calldataOffset),
  )
  let refusedByBoth = 0
  let widenedHarmlessly = 0
  const check = (mutant: Hex) => {
    if (accepts(legacy, mutant)) return
    if (accepts(current, mutant)) {
      expect(harmless(mutant), `widened: ${mutant}`).toBe(true)
      widenedHarmlessly++
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
  return { refusedByBoth, widenedHarmlessly }
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

/** Non-zero 32-byte words in an encoded policy initData. */
function nonZeroWords(initData: Hex): number {
  let count = 0
  for (let at = 0; at < size(initData); at += 32) {
    if (hexToBigInt(slice(initData, at, at + 32)) !== 0n) count++
  }
  return count
}

const actionWords = (action: ScopedAction) =>
  (action.policies ?? []).reduce(
    (sum, policy) =>
      sum + nonZeroWords(encodeSessionPolicy(policy, 'production').initData),
    0,
  )

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

interface StoredRule {
  readonly condition: number
  readonly offset: bigint
  readonly isLimited: boolean
  readonly ref: Hex
  readonly usage: { readonly limit: bigint; readonly used: bigint }
}

/**
 * The storage slots a params policy writes on enable, as each contract's `fill`
 * writes them: a rule is 4 slots (condition/offset/isLimited packed, ref,
 * limit, used). UniversalActionPolicy stores only the first `length` of its 16
 * rules; ArgPolicy also stores its root index, both array lengths and a slot per
 * tree node.
 */
function storageSlots(policy: SessionPolicy) {
  const { initData } = encodeSessionPolicy(policy, 'production')
  const ruleSlots = (r: StoredRule) => [
    BigInt(r.condition) | r.offset | (r.isLimited ? 1n : 0n),
    hexToBigInt(r.ref),
    r.usage.limit,
    r.usage.used,
  ]
  let slots: bigint[]
  if (policy.type === 'universal-action') {
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
                { name: 'length', type: 'uint256' },
                {
                  name: 'rules',
                  type: 'tuple[16]',
                  components: ruleComponents,
                },
              ],
            },
          ],
        },
      ],
      initData,
    )
    const { length, rules } = config.paramRules
    slots = [
      config.valueLimitPerUse,
      length,
      ...rules.slice(0, Number(length)).flatMap(ruleSlots),
    ]
  } else if (policy.type === 'arg-policy') {
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
      initData,
    )
    const { rootNodeIndex, rules, packedNodes } = config.paramRules
    slots = [
      config.valueLimitPerUse,
      BigInt(rootNodeIndex),
      BigInt(rules.length),
      ...rules.flatMap(ruleSlots),
      BigInt(packedNodes.length),
      ...packedNodes,
    ]
  } else {
    return { nonZero: 0, zero: 0 }
  }
  const nonZero = slots.filter((s) => s !== 0n).length
  return { nonZero, zero: slots.length - nonZero }
}

const paramsPolicy = (action: ScopedAction) => {
  const policy = action.policies?.find(
    (p) => p.type === 'universal-action' || p.type === 'arg-policy',
  )
  if (!policy) throw new Error('no params policy')
  return policy
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
        publish({ routeDeadline: 0n }),
      ],
    },
    {
      name: 'a 50 bps floor',
      ctx: { ...ecoCtx, maxFeeBps: 50 },
      valid: [publish({ delivered: 100n })],
    },
    {
      name: 'two legs with their own recipients and prover sets',
      ctx: {
        ...ecoCtx,
        destinations: [
          { chainId: arbitrum.id, token: USDC_ARB, recipient: ECO_ACCOUNT },
          { chainId: optimism.id, token: USDC_OP, recipient: ATTACKER },
        ],
      },
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
      name: 'two legs sharing the recipient and prover set',
      ctx: {
        ...ecoCtx,
        destinations: [
          { chainId: arbitrum.id, token: USDC_ARB, recipient: ECO_ACCOUNT },
          { chainId: mainnet.id, token: USDC_ETH, recipient: ECO_ACCOUNT },
        ],
      },
      valid: [
        publish(),
        publish({ destination: 1n, routeToken: USDC_ETH }),
        publish({ destination: 1n, routeToken: USDC_ETH, prover: CCIP_PROVER }),
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
    const { refusedByBoth, widenedHarmlessly } = expectNoWidening(
      legacyEco(ctx),
      scopeEco(ctx),
      valid,
      alternatives,
      [relocatedRoute, emptiedCalls],
      unfillable,
    )
    expect(refusedByBoth).toBeGreaterThan(0)
    expect(widenedHarmlessly).toBe(0)
  })

  test('a leg is not satisfied by another leg’s recipient or token', () => {
    const [, legs] = cases
    const current = scopeEco(legs.ctx)
    const crossed = [
      publish({ destination: 10n, routeToken: USDC_OP }),
      publish({ recipient: ATTACKER }),
      publish({ destination: 10n, recipient: ATTACKER }),
    ]
    for (const calldata of crossed) {
      expect(accepts(legacyEco(legs.ctx), calldata)).toBe(false)
      expect(accepts(current, calldata)).toBe(false)
    }
  })

  test('the old policy already admits an unfillable publish', () => {
    // A route deadline in the past: no solver can fill it, and the reward only
    // refunds after its deadline. Non-canonical route bytes do no more.
    expect(accepts(legacyEco(ecoCtx), publish({ routeDeadline: 0n }))).toBe(
      true,
    )
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
    const [, , , shared] = cases
    for (const action of [legacyEco(shared.ctx), scopeEco(shared.ctx)]) {
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
})

/** A permit's settlement actions on Base (Arbitrum for OFT), as a session enables them. */
function settlementActions(permit: CrossChainPermissionInput, chainId: number) {
  const resolved = resolveSettlementScope(
    [resolveCrossChainPermission(permit)],
    {
      chainId,
      environment: 'production',
      account: ECO_ACCOUNT,
      oneTimeUse: true,
      settlement: SETTLEMENT_CATALOG,
    },
  )
  if (!resolved) throw new Error('expected a settlement scope')
  return resolved.actions
}

const cctpActions = () =>
  settlementActions(
    {
      from: { chain: base, token: USDC_BASE, maxAmount: 100n },
      to: { chain: arbitrum, token: USDC_ARB },
      settlementLayers: ['CCTP'],
    },
    base.id,
  )
const oftActions = () =>
  settlementActions(
    {
      from: {
        chain: arbitrum,
        token: SETTLEMENT_CATALOG[arbitrum.id].oft!.token,
        maxAmount: 100n,
      },
      to: { chain: plasma, token: SETTLEMENT_CATALOG[plasma.id].oft!.token },
      settlementLayers: ['OFT'],
    },
    arbitrum.id,
  )
const ecoActions = () =>
  settlementActions(
    {
      from: { chain: base, token: USDC_BASE, maxAmount: 100n },
      to: { chain: arbitrum, token: USDC_ARB },
      settlementLayers: ['ECO_IE'],
      maxFeeBps: 100,
      validUntil: new Date(1_900_000_000_000),
    },
    base.id,
  )

describe('policy size on enable', () => {
  test('UniversalActionPolicy stays cheaper than ArgPolicy for every rule list it carries', () => {
    // Its fixed 16-rule array is zero words, and `fill` stores only `length`
    // rules; ArgPolicy stores the same rules plus a slot per tree node.
    const universal = [...cctpActions(), ...oftActions(), ...ecoActions()]
      .map(paramsPolicy)
      .filter((p) => p.type === 'universal-action')
    expect(universal.length).toBe(5)
    for (const policy of universal) {
      if (policy.type !== 'universal-action') continue
      const asArg: SessionPolicy = {
        type: 'arg-policy',
        valueLimitPerUse: policy.valueLimitPerUse ?? 0n,
        expression: allOf([...policy.rules]),
      }
      const words = (p: SessionPolicy) =>
        nonZeroWords(encodeSessionPolicy(p, 'production').initData)
      expect(words(policy)).toBeLessThan(words(asArg))
      expect(storageSlots(policy).nonZero).toBeLessThan(
        storageSlots(asArg).nonZero,
      )
    }
  })

  test('non-zero words written per action, before and after', () => {
    const measure = (action: ScopedAction) => ({
      words: actionWords(action),
      slots: storageSlots(paramsPolicy(action)),
    })
    const [cctpBurn, cctpApprove] = cctpActions()
    const [oftSend, oftApprove] = oftActions()
    const [ecoPublish, ecoApprove] = ecoActions()
    const timeFrame = ecoPublish.policies?.slice(1) ?? []
    const legacyPublish = legacyEco({
      ...ecoCtx,
      validUntil: 1_900_000_000n,
      timeFrame,
    })
    const twoLegs = {
      ...ecoCtx,
      destinations: [
        { chainId: arbitrum.id, token: USDC_ARB, recipient: ECO_ACCOUNT },
        { chainId: mainnet.id, token: USDC_ETH, recipient: ECO_ACCOUNT },
      ],
    }
    const session = (actions: ScopedAction[]) =>
      actions.reduce((sum, a) => sum + actionWords(a), 0)
    expect({
      ecoPublish: {
        before: measure(legacyPublish),
        after: measure(ecoPublish),
      },
      ecoPublishTwoLegs: {
        before: measure(legacyEco(twoLegs)),
        after: measure(scopeEco(twoLegs)),
      },
      ecoApprove: measure(ecoApprove),
      cctpBurn: measure(cctpBurn),
      cctpApprove: measure(cctpApprove),
      oftSend: measure(oftSend),
      oftApprove: measure(oftApprove),
      cctpPlusEcoSession: {
        before: session([cctpBurn, cctpApprove, legacyPublish, ecoApprove]),
        after: session([cctpBurn, cctpApprove, ecoPublish, ecoApprove]),
      },
    }).toMatchInlineSnapshot(`
      {
        "cctpApprove": {
          "slots": {
            "nonZero": 5,
            "zero": 5,
          },
          "words": 7,
        },
        "cctpBurn": {
          "slots": {
            "nonZero": 11,
            "zero": 11,
          },
          "words": 12,
        },
        "cctpPlusEcoSession": {
          "after": 163,
          "before": 163,
        },
        "ecoApprove": {
          "slots": {
            "nonZero": 5,
            "zero": 5,
          },
          "words": 8,
        },
        "ecoPublish": {
          "after": {
            "slots": {
              "nonZero": 125,
              "zero": 70,
            },
            "words": 136,
          },
          "before": {
            "slots": {
              "nonZero": 125,
              "zero": 70,
            },
            "words": 136,
          },
        },
        "ecoPublishTwoLegs": {
          "after": {
            "slots": {
              "nonZero": 168,
              "zero": 93,
            },
            "words": 180,
          },
          "before": {
            "slots": {
              "nonZero": 168,
              "zero": 93,
            },
            "words": 180,
          },
        },
        "oftApprove": {
          "slots": {
            "nonZero": 5,
            "zero": 5,
          },
          "words": 7,
        },
        "oftSend": {
          "slots": {
            "nonZero": 25,
            "zero": 29,
          },
          "words": 28,
        },
      }
    `)
  })
})
