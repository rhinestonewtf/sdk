import {
  type Address,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  isAddress,
  pad,
  size,
  slice,
  toHex,
} from 'viem'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { satisfiesRules as holds } from '../../../../../test/utils/policy-rules'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import type {
  ArgPolicyExpression,
  UniversalActionPolicyParamRule,
} from '../types'
import {
  ECO_MIN_VALIDITY_SECONDS,
  ecoPortalAbi,
  PUBLISH,
  PUBLISH_AND_FUND_SELECTOR,
  scopeEco,
} from './eco'

const stablecoins = (chainId: number) =>
  SETTLEMENT_CATALOG[chainId].eco!.stablecoins
const ECO_PORTAL = SETTLEMENT_CATALOG[8453].eco!.portal
const USDC_BASE = stablecoins(8453)[0]
const USDC_ARB = stablecoins(42161)[0]
const USDT0_ARB = stablecoins(42161)[1]
const USDC_OP = stablecoins(10)[0]
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const HYPER_PROVER = '0xec004Ab4870c4e177c66949329dCdb503CE41022' as Address
const CCIP_PROVER = '0xceBB7cDDBA4734C7130BF114a37C2dA4C5f3c473' as Address
const POLYMER_PROVER = '0xE3e4e6F284f1c8E17bafE4268EB98c36886B4d8B' as Address

const routeAbi = [
  {
    type: 'tuple',
    components: [
      { name: 'salt', type: 'bytes32' },
      { name: 'deadline', type: 'uint64' },
      { name: 'portal', type: 'address' },
      { name: 'nativeAmount', type: 'uint256' },
      {
        name: 'tokens',
        type: 'tuple[]',
        components: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'data', type: 'bytes' },
          { name: 'value', type: 'uint256' },
        ],
      },
    ],
  },
] as const

type Overrides = Partial<{
  destination: bigint
  portal: Address
  routeNative: bigint
  routeDeadline: bigint
  routeToken: Address
  delivered: bigint
  callTarget: Address
  callData: Hex
  extraCall: boolean
  prover: Address
  creator: Address
  rewardToken: Address
  reward: bigint
  rewardNative: bigint
  deadline: bigint
  allowPartial: boolean
}>

/** A publishAndFund call shaped exactly as the orchestrator forwards Eco's. */
function publish(o: Overrides = {}): Hex {
  const delivered = o.delivered ?? 99n
  const token = o.routeToken ?? USDC_ARB
  const call = {
    target: o.callTarget ?? token,
    data:
      o.callData ??
      encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [ACCOUNT, delivered],
      }),
    value: 0n,
  }
  const route = encodeAbiParameters(routeAbi, [
    {
      salt: pad('0x42'),
      deadline: o.routeDeadline ?? 1_900_000_000n,
      portal: o.portal ?? ECO_PORTAL,
      nativeAmount: o.routeNative ?? 0n,
      tokens: [{ token, amount: delivered }],
      calls: o.extraCall ? [call, call] : [call],
    },
  ])
  return encodeFunctionData({
    abi: ecoPortalAbi,
    functionName: 'publishAndFund',
    args: [
      o.destination ?? 42161n,
      route,
      {
        deadline: o.deadline ?? 1_900_000_000n,
        creator: o.creator ?? ACCOUNT,
        prover: o.prover ?? HYPER_PROVER,
        nativeAmount: o.rewardNative ?? 0n,
        tokens: [
          { token: o.rewardToken ?? USDC_BASE, amount: o.reward ?? 100n },
        ],
      },
      o.allowPartial ?? false,
    ],
  })
}

const NOW = 1_800_000_000n

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Number(NOW * 1000n))
})
afterAll(() => {
  vi.useRealTimers()
})

const word = (calldata: Hex, offset: bigint) =>
  BigInt(slice(calldata, 4 + Number(offset), 36 + Number(offset)))

const base = {
  chainId: 8453,
  settlement: SETTLEMENT_CATALOG,
  target: ECO_PORTAL,
  account: ACCOUNT,
  sourceTokens: [USDC_BASE],
  destinations: [{ chainId: 42161, token: USDC_ARB, recipient: ACCOUNT }],
  cap: 100n,
  maxFeeBps: 100,
  validUntil: 1_900_000_000n,
} as const

describe('publishAndFund offsets', () => {
  test('each offset reads the field it names', () => {
    const c = publish({ delivered: 77n, reward: 88n, deadline: 123n })
    expect(word(c, PUBLISH.destination)).toBe(42161n)
    expect(word(c, PUBLISH.routePointer)).toBe(0x80n)
    expect(word(c, PUBLISH.rewardPointer)).toBe(0x300n)
    expect(word(c, PUBLISH.routeLength)).toBe(0x260n)
    expect(word(c, PUBLISH.routeTuplePointer)).toBe(0x20n)
    expect(word(c, PUBLISH.routeDeadline)).toBe(1_900_000_000n)
    expect(word(c, PUBLISH.routePortal)).toBe(BigInt(ECO_PORTAL))
    expect(word(c, PUBLISH.routeTokensPointer)).toBe(0xc0n)
    expect(word(c, PUBLISH.routeCallsPointer)).toBe(0x120n)
    expect(word(c, PUBLISH.routeTokensLength)).toBe(1n)
    expect(word(c, PUBLISH.routeToken)).toBe(BigInt(USDC_ARB))
    expect(word(c, PUBLISH.routeTokenAmount)).toBe(77n)
    expect(word(c, PUBLISH.callsLength)).toBe(1n)
    expect(word(c, PUBLISH.callPointer)).toBe(0x20n)
    expect(word(c, PUBLISH.callTarget)).toBe(BigInt(USDC_ARB))
    expect(word(c, PUBLISH.callDataPointer)).toBe(0x60n)
    expect(word(c, PUBLISH.callDataLength)).toBe(0x44n)
    expect(word(c, PUBLISH.transferRecipient)).toBe(BigInt(ACCOUNT))
    expect(word(c, PUBLISH.transferAmount)).toBe(77n)
    expect(word(c, PUBLISH.rewardDeadline)).toBe(123n)
    expect(word(c, PUBLISH.rewardCreator)).toBe(BigInt(ACCOUNT))
    expect(word(c, PUBLISH.rewardProver)).toBe(BigInt(HYPER_PROVER))
    expect(word(c, PUBLISH.rewardTokensPointer)).toBe(0xa0n)
    expect(word(c, PUBLISH.rewardTokensLength)).toBe(1n)
    expect(word(c, PUBLISH.rewardToken)).toBe(BigInt(USDC_BASE))
    expect(word(c, PUBLISH.rewardAmount)).toBe(88n)
    expect(PUBLISH_AND_FUND_SELECTOR).toBe('0xdf00f8fa')
  })
})

describe('scopeEco', () => {
  const action = scopeEco(base)

  test('admits the publish the orchestrator forwards', () => {
    expect(holds(action, publish())).toBe(true)
  })

  test('admits only provers deployed on both chains of the leg', () => {
    // Base -> Arbitrum: Hyperlane and Polymer are on both; CCIP is not on Arbitrum.
    expect(holds(action, publish({ prover: HYPER_PROVER }))).toBe(true)
    expect(holds(action, publish({ prover: POLYMER_PROVER }))).toBe(true)
    expect(holds(action, publish({ prover: CCIP_PROVER }))).toBe(false)
  })

  test.each([
    [
      'recipient',
      {
        callData: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [OTHER, 99n],
        }),
      },
    ],
    [
      'call selector (approve)',
      {
        callData: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [ACCOUNT, 99n],
        }),
      },
    ],
    ['destination', { destination: 10n }],
    ['destination portal', { portal: OTHER }],
    ['delivery token', { routeToken: USDT0_ARB, callTarget: USDT0_ARB }],
    ['call target', { callTarget: OTHER }],
    ['route native amount', { routeNative: 1n }],
    ['prover', { prover: OTHER }],
    ['creator', { creator: OTHER }],
    ['reward token', { rewardToken: USDC_OP }],
    ['reward over the cap', { reward: 101n }],
    ['reward native amount', { rewardNative: 1n }],
    ['deadline past validUntil', { deadline: 1_900_000_001n }],
    ['route deadline past validUntil', { routeDeadline: 1_900_000_001n }],
    ['allowPartial', { allowPartial: true }],
    ['second call', { extraCall: true }],
    ['delivery under the floor', { delivered: 98n }],
  ] as const)('refuses a publish with another %s', (_, overrides) => {
    expect(holds(action, publish(overrides))).toBe(false)
  })

  /** Overwrite one args word of the canonical publish. */
  const rewrite = (offset: bigint, value: bigint): Hex => {
    const c = publish()
    const at = 4 + Number(offset)
    return concat([
      slice(c, 0, at),
      pad(toHex(value)),
      ...(at + 32 < size(c) ? [slice(c, at + 32)] : []),
    ])
  }

  test.each([
    ['a transfer amount under the floor', PUBLISH.transferAmount, 1n],
    ['a route amount under the floor', PUBLISH.routeTokenAmount, 1n],
    ['a re-laid-out reward pointer', PUBLISH.rewardPointer, 0x320n],
    ['a second call declared inside the route', PUBLISH.callsLength, 2n],
  ] as const)('refuses %s', (_, offset, value) => {
    expect(holds(action, rewrite(offset, value))).toBe(false)
  })

  test('refuses a recipient that differs only past the head word', () => {
    // The head word pins the selector and the recipient's first 16 bytes; the
    // last 4 are pinned by the recipient word alone.
    const near = '0x1111111111111111111111111111111111112222' as Address
    const callData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [near, 99n],
    })
    expect(holds(action, publish({ callData }))).toBe(false)
  })

  test('the floor rounds up, so the solver never keeps more than maxFeeBps', () => {
    // 100 at 50 bps is a 99.5 floor: rounding down to 99 would let the solver
    // keep 100 bps.
    const tight = scopeEco({ ...base, maxFeeBps: 50 })
    expect(holds(tight, publish({ delivered: 100n }))).toBe(true)
    expect(holds(tight, publish({ delivered: 99n }))).toBe(false)
  })

  test('the floor is maxAmount minus maxFeeBps, and the reward cap is cumulative', () => {
    // cap 100, 100 bps → floor 99
    expect(holds(action, publish({ delivered: 99n }))).toBe(true)
    expect(holds(action, publish({ reward: 60n }), 50n)).toBe(false)
  })

  test('pairs each destination with its own token and recipient', () => {
    const twoLegs = scopeEco({
      ...base,
      destinations: [
        { chainId: 42161, token: USDC_ARB, recipient: ACCOUNT },
        { chainId: 10, token: USDC_OP, recipient: ACCOUNT },
      ],
    })
    expect(holds(twoLegs, publish())).toBe(true)
    expect(
      holds(twoLegs, publish({ destination: 10n, routeToken: USDC_OP })),
    ).toBe(true)
    expect(holds(twoLegs, publish({ destination: 10n }))).toBe(false)
  })

  test.each([
    [
      'a chain Eco does not route to',
      { destinations: [{ chainId: 56, token: USDC_ARB, recipient: ACCOUNT }] },
      'ECO_IE does not route to chain 56',
    ],
    [
      'a `from` token that is not a stablecoin',
      { sourceTokens: [OTHER] },
      'the `from` token on chain 8453',
    ],
    [
      'a `to` token that is not a stablecoin',
      { destinations: [{ chainId: 42161, token: OTHER, recipient: ACCOUNT }] },
      'the `to` token on chain 42161',
    ],
    [
      'an open recipient',
      { destinations: [{ chainId: 42161, token: USDC_ARB }] },
      'needs a concrete recipient',
    ],
    ['no cap', { cap: undefined }, 'needs maxAmount and maxFeeBps'],
    ['no maxFeeBps', { maxFeeBps: undefined }, 'needs maxAmount and maxFeeBps'],
    [
      'a maxFeeBps of 10000',
      { maxFeeBps: 10_000 },
      'maxFeeBps must be an integer',
    ],
    [
      'a fractional maxFeeBps',
      { maxFeeBps: 1.5 },
      'maxFeeBps must be an integer',
    ],
    ['a negative maxFeeBps', { maxFeeBps: -1 }, 'maxFeeBps must be an integer'],
    ['no validUntil', { validUntil: undefined }, 'needs validUntil'],
    ['no account', { account: undefined }, 'needs `account`'],
    [
      'more than one source token',
      { sourceTokens: [USDC_BASE, OTHER] },
      'exactly one `from` token',
    ],
    [
      'a leg with no prover on both chains',
      {
        chainId: 2020,
        target: SETTLEMENT_CATALOG[2020].eco!.portal,
        sourceTokens: [stablecoins(2020)[0]],
      },
      'no Eco prover is deployed on both chain 2020 and chain 42161',
    ],
  ] as const)('refuses %s', (_, overrides, message) => {
    expect(() => scopeEco({ ...base, ...overrides })).toThrow(message)
  })

  test('a Ronin leg admits only the CCIP prover', () => {
    const ronin = scopeEco({
      ...base,
      chainId: 2020,
      target: SETTLEMENT_CATALOG[2020].eco!.portal,
      sourceTokens: [stablecoins(2020)[0]],
      destinations: [{ chainId: 8453, token: USDC_BASE, recipient: ACCOUNT }],
    })
    const toBase = (prover: Address) =>
      publish({
        destination: 8453n,
        routeToken: USDC_BASE,
        rewardToken: stablecoins(2020)[0],
        prover,
      })
    expect(holds(ronin, toBase(CCIP_PROVER))).toBe(true)
    expect(holds(ronin, toBase(HYPER_PROVER))).toBe(false)
  })

  /** Every rule in an ArgPolicy expression, OR branches included. */
  const rulesOf = (e: ArgPolicyExpression): UniversalActionPolicyParamRule[] =>
    e.type === 'rule'
      ? [e.rule]
      : e.type === 'not'
        ? rulesOf(e.child)
        : [...rulesOf(e.left), ...rulesOf(e.right)]

  const expression = (() => {
    const policy = action.policies?.[0]
    if (policy?.type !== 'arg-policy') throw new Error('expected an arg policy')
    return policy.expression
  })()

  test('every pinned word refuses any other value', () => {
    // Each equal rule must bind on its own: nudge its word and the publish
    // must fail, whichever pin it is.
    const pinned = rulesOf(expression).filter((r) => r.condition === 'equal')
    expect(pinned.length).toBeGreaterThan(25)
    for (const rule of pinned) {
      const nudged = BigInt(rule.referenceValue) + 1n
      expect(
        holds(action, rewrite(rule.calldataOffset, nudged)),
        `offset ${rule.calldataOffset}`,
      ).toBe(false)
    }
  })

  test('many destinations stay within ArgPolicy limits', () => {
    const chains = [1, 10, 130, 137, 999, 9745, 42161] as const
    const wide = scopeEco({
      ...base,
      destinations: chains.map((chainId) => ({
        chainId,
        token: stablecoins(chainId)[0],
        recipient: ACCOUNT,
      })),
    })
    const policy = wide.policies?.[0]
    if (policy?.type !== 'arg-policy') throw new Error('expected an arg policy')
    expect(rulesOf(policy.expression).length).toBeLessThanOrEqual(128)
  })

  test("pins the route to the destination chain's Portal", () => {
    const SRC = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address
    const DST = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address
    const portal = (id: number, address: Address) => ({
      ...SETTLEMENT_CATALOG[id],
      eco: { ...SETTLEMENT_CATALOG[id].eco!, portal: address },
    })
    const distinct = scopeEco({
      ...base,
      target: SRC,
      settlement: {
        ...SETTLEMENT_CATALOG,
        8453: portal(8453, SRC),
        42161: portal(42161, DST),
      },
    })
    expect(holds(distinct, publish({ portal: DST }))).toBe(true)
    expect(holds(distinct, publish({ portal: SRC }))).toBe(false)
  })

  test('a leg admits only the provers served on both of its chains', () => {
    // Base serves Hyper and CCIP (lowercased), Arbitrum CCIP and Polymer.
    const settlement = {
      ...SETTLEMENT_CATALOG,
      8453: {
        ...SETTLEMENT_CATALOG[8453],
        eco: {
          ...SETTLEMENT_CATALOG[8453].eco!,
          provers: [HYPER_PROVER, CCIP_PROVER.toLowerCase() as Address],
        },
      },
      42161: {
        ...SETTLEMENT_CATALOG[42161],
        eco: {
          ...SETTLEMENT_CATALOG[42161].eco!,
          provers: [CCIP_PROVER, POLYMER_PROVER],
        },
      },
    }
    const narrowed = scopeEco({ ...base, settlement })
    expect(holds(narrowed, publish({ prover: CCIP_PROVER }))).toBe(true)
    expect(holds(narrowed, publish({ prover: HYPER_PROVER }))).toBe(false)
    expect(holds(narrowed, publish({ prover: POLYMER_PROVER }))).toBe(false)
  })

  test('validUntil must reach the 7 days Eco quotes its reward deadline', () => {
    const at = (validUntil: bigint) => () => scopeEco({ ...base, validUntil })
    expect(at(NOW + ECO_MIN_VALIDITY_SECONDS)).not.toThrow()
    expect(at(NOW + ECO_MIN_VALIDITY_SECONDS - 1n)).toThrow(
      'ECO_IE needs validUntil at least 7 days ahead',
    )
  })

  describe('the 1:1 floor needs every token served at 6 decimals', () => {
    const withUsd = (
      chainId: number,
      usdStablecoins:
        | { address: Address; symbol: string; decimals: number }[]
        | undefined,
    ) => ({
      ...SETTLEMENT_CATALOG,
      [chainId]: { ...SETTLEMENT_CATALOG[chainId], usdStablecoins },
    })

    test.each([
      [
        'an 18-decimal `from` token',
        withUsd(8453, [{ address: USDC_BASE, symbol: 'USDC', decimals: 18 }]),
        'the `from` token 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 on chain 8453 must be a served 6-decimal USD stablecoin; it has 18 decimals',
      ],
      [
        'an 18-decimal `to` token',
        withUsd(42161, [{ address: USDC_ARB, symbol: 'USDC', decimals: 18 }]),
        'the `to` token 0xaf88d065e77c8cc2239327c5edb3a432268e5831 on chain 42161 must be a served 6-decimal USD stablecoin; it has 18 decimals',
      ],
      [
        'no served usdStablecoins',
        withUsd(8453, undefined),
        'the orchestrator serves no usdStablecoins entry for it',
      ],
      [
        'a token missing from usdStablecoins',
        withUsd(42161, [{ address: USDT0_ARB, symbol: 'USDT0', decimals: 6 }]),
        'the orchestrator serves no usdStablecoins entry for it',
      ],
    ])('refuses %s', (_, settlement, message) => {
      expect(() => scopeEco({ ...base, settlement })).toThrow(message)
    })
  })

  test('refuses a chain the orchestrator serves no ECO block for', () => {
    const { eco: _, ...arbitrum } = SETTLEMENT_CATALOG[42161]
    expect(() =>
      scopeEco({
        ...base,
        settlement: { ...SETTLEMENT_CATALOG, 42161: arbitrum },
      }),
    ).toThrow('ECO_IE does not route to chain 42161')
  })

  test('every fixture address is valid', () => {
    for (const { eco } of Object.values(SETTLEMENT_CATALOG)) {
      if (!eco) continue
      expect(isAddress(eco.portal)).toBe(true)
      for (const prover of eco.provers) expect(isAddress(prover)).toBe(true)
      for (const token of eco.stablecoins) expect(isAddress(token)).toBe(true)
    }
  })
})
