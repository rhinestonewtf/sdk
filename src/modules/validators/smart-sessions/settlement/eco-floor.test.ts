import { type Address, getAddress } from 'viem'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { frozenScopeEco } from '../../../../../test/utils/eco-frozen'
import {
  ECO_ACCOUNT as ACCOUNT,
  ECO_PORTAL,
  publish,
} from '../../../../../test/utils/eco-publish'
import { satisfiesRules as holds } from '../../../../../test/utils/policy-rules'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { scopeEco } from './eco'
import type { SettlementCatalog, SettlementContext } from './types'

const stablecoins = (chainId: number) =>
  SETTLEMENT_CATALOG[chainId].eco!.stablecoins
const USDC_BASE = stablecoins(8453)[0]
const USDC_ARB = stablecoins(42161)[0]
const USDT0_ARB = stablecoins(42161)[1]
const USDC_OP = stablecoins(10)[0]
const OTHER = '0x2222222222222222222222222222222222222222' as Address

const NOW = 1_800_000_000n

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Number(NOW * 1000n))
})
afterAll(() => {
  vi.useRealTimers()
})

const base: SettlementContext = {
  chainId: 8453,
  settlement: SETTLEMENT_CATALOG,
  target: ECO_PORTAL,
  account: ACCOUNT,
  sourceTokens: [USDC_BASE],
  destinations: [{ chainId: 42161, token: USDC_ARB, recipient: ACCOUNT }],
  cap: 100n,
  maxFeeBps: 100,
  validUntil: 1_900_000_000n,
}

describe('scopeEco against the frozen builder', () => {
  const caps = [1n, 99n, 100n, 999_999n, 10n ** 12n, 2n ** 128n - 1n]
  const fees = [0, 1, 50, 100, 2_500, 9_999]
  const legSets = {
    'Base to Arbitrum USDC': [
      { chainId: 42161, token: USDC_ARB, recipient: ACCOUNT },
    ],
    'Base to Arbitrum USDT0': [
      { chainId: 42161, token: USDT0_ARB, recipient: ACCOUNT },
    ],
    'two legs': [
      { chainId: 42161, token: USDC_ARB, recipient: ACCOUNT },
      { chainId: 10, token: USDC_OP, recipient: ACCOUNT },
    ],
    'seven legs': [1, 10, 130, 137, 999, 9745, 42161].map((chainId) => ({
      chainId,
      token: stablecoins(chainId)[0],
      recipient: ACCOUNT,
    })),
  }

  for (const [name, destinations] of Object.entries(legSets)) {
    test.each(
      caps.flatMap((cap) => fees.map((maxFeeBps) => [cap, maxFeeBps] as const)),
    )(`${name}: cap %s at %s bps emits the same policy`, (cap, maxFeeBps) => {
      const ctx = { ...base, destinations, cap, maxFeeBps }
      expect(scopeEco(ctx)).toEqual(frozenScopeEco(ctx))
    })
  }

  test('a Ronin source emits the same policy', () => {
    const ctx = {
      ...base,
      chainId: 2020,
      target: SETTLEMENT_CATALOG[2020].eco!.portal,
      sourceTokens: [stablecoins(2020)[0]],
      destinations: [{ chainId: 8453, token: USDC_BASE, recipient: ACCOUNT }],
    }
    expect(scopeEco(ctx)).toEqual(frozenScopeEco(ctx))
  })

  test('a later validUntil emits the same policy', () => {
    const ctx = { ...base, validUntil: NOW + 30n * 86_400n }
    expect(scopeEco(ctx)).toEqual(frozenScopeEco(ctx))
  })

  test.each([
    ['an unserved `from` token', { sourceTokens: [OTHER] }],
    [
      'an unserved `to` token',
      { destinations: [{ chainId: 42161, token: OTHER, recipient: ACCOUNT }] },
    ],
    [
      'a chain Eco does not route to',
      { destinations: [{ chainId: 56, token: USDC_ARB, recipient: ACCOUNT }] },
    ],
    [
      'an open recipient',
      { destinations: [{ chainId: 42161, token: USDC_ARB }] },
    ],
    ['no cap', { cap: undefined }],
    ['no maxFeeBps', { maxFeeBps: undefined }],
    ['a maxFeeBps of 10000', { maxFeeBps: 10_000 }],
    ['a short validUntil', { validUntil: NOW + 86_400n }],
    ['no account', { account: undefined }],
    ['two source tokens', { sourceTokens: [USDC_BASE, OTHER] }],
  ] as const)('refuses %s with the same message', (_, overrides) => {
    const ctx = { ...base, ...overrides } as SettlementContext
    expect(() => frozenScopeEco(ctx)).toThrow()
    let frozen = ''
    try {
      frozenScopeEco(ctx)
    } catch (error) {
      frozen = (error as Error).message
    }
    expect(() => scopeEco(ctx)).toThrow(frozen)
  })
})

/** The floor each delivery word must clear, read back from the policy. */
const floors = (ctx: SettlementContext) => {
  const policy = scopeEco(ctx).policies?.[0]
  if (policy?.type !== 'arg-policy') throw new Error('expected an arg policy')
  const out: bigint[] = []
  const walk = (e: typeof policy.expression): void => {
    if (e.type === 'rule') {
      if (e.rule.condition === 'greaterThanOrEqual')
        out.push(BigInt(e.rule.referenceValue))
    } else if (e.type === 'not') walk(e.child)
    else {
      walk(e.left)
      walk(e.right)
    }
  }
  walk(policy.expression)
  return out
}

// Served 18-decimal USD stablecoins, as the orchestrator could serve them.
const USD18_BASE = '0x1818181818181818181818181818181818181818' as Address
const USD18_ARB = '0x8181818181818181818181818181818181818181' as Address
const WETH_ARB = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1' as Address
const E6 = 10n ** 6n
const E18 = 10n ** 18n

const serve = (
  chainId: number,
  token: Address,
  decimals: number,
): SettlementCatalog[number] => ({
  ...SETTLEMENT_CATALOG[chainId],
  eco: {
    ...SETTLEMENT_CATALOG[chainId].eco!,
    stablecoins: [...SETTLEMENT_CATALOG[chainId].eco!.stablecoins, token],
  },
  usdStablecoins: [
    ...(SETTLEMENT_CATALOG[chainId].usdStablecoins ?? []),
    { address: token, symbol: 'USD18', decimals },
  ],
})
const WITH_18: SettlementCatalog = {
  ...SETTLEMENT_CATALOG,
  8453: serve(8453, USD18_BASE, 18),
  42161: serve(42161, USD18_ARB, 18),
}

describe('the maxFeeBps floor rescales between served decimals', () => {
  test.each([
    ['6 to 6', USDC_BASE, USDC_ARB, 100n * E6, 100, [99n * E6]],
    ['USDC to USDT0', USDC_BASE, USDT0_ARB, 100n * E6, 100, [99n * E6]],
    ['6 to 18', USDC_BASE, USD18_ARB, 100n * E6, 100, [99n * E18]],
    ['18 to 6', USD18_BASE, USDC_ARB, 100n * E18, 100, [99n * E6]],
    ['18 to 18', USD18_BASE, USD18_ARB, 100n * E18, 50, [995n * 10n ** 17n]],
    // Rescaling down rounds up: one wei of an 18-decimal cap still owes a unit.
    ['18 to 6, one wei', USD18_BASE, USDC_ARB, 1n, 0, [1n]],
    [
      '18 to 6, a unit and a wei',
      USD18_BASE,
      USDC_ARB,
      10n ** 12n + 1n,
      0,
      [2n],
    ],
    [
      '18 to 6, a dust cap at 9999 bps',
      USD18_BASE,
      USDC_ARB,
      3n * 10n ** 12n,
      9_999,
      [1n],
    ],
  ] as const)('%s', (_, from, to, cap, maxFeeBps, expected) => {
    const ctx = {
      ...base,
      settlement: WITH_18,
      sourceTokens: [from],
      destinations: [{ chainId: 42161, token: to, recipient: ACCOUNT }],
      cap,
      maxFeeBps,
    }
    // Both the route amount and the transfer amount carry the floor.
    expect(floors(ctx)).toEqual([...expected, ...expected])
  })

  test('6 to 18 admits the floor and refuses a wei under it', () => {
    const ctx = {
      ...base,
      settlement: WITH_18,
      destinations: [{ chainId: 42161, token: USD18_ARB, recipient: ACCOUNT }],
      cap: 100n * E6,
    }
    const action = scopeEco(ctx)
    const at = (delivered: bigint) =>
      publish({ routeToken: USD18_ARB, delivered, reward: 100n * E6 })
    expect(holds(action, at(99n * E18))).toBe(true)
    expect(holds(action, at(99n * E18 - 1n))).toBe(false)
    // The unscaled 6-decimal floor is dust in 18 decimals.
    expect(holds(action, at(99n * E6))).toBe(false)
  })

  test.each([
    [
      'an unserved `from` token',
      { sourceTokens: [OTHER] },
      'ECO_IE moves only USD stablecoins; the `from` token',
    ],
    [
      'an unserved `to` token',
      {
        destinations: [{ chainId: 42161, token: WETH_ARB, recipient: ACCOUNT }],
      },
      'ECO_IE moves only USD stablecoins; the `to` token',
    ],
    [
      'an Eco token with no served decimals',
      {
        settlement: {
          ...SETTLEMENT_CATALOG,
          42161: {
            ...SETTLEMENT_CATALOG[42161],
            eco: {
              ...SETTLEMENT_CATALOG[42161].eco!,
              stablecoins: [WETH_ARB],
            },
          },
        },
        destinations: [{ chainId: 42161, token: WETH_ARB, recipient: ACCOUNT }],
      },
      'the orchestrator serves no usdStablecoins entry for it',
    ],
    [
      'an unserved `to` token, even with a to.minAmount',
      {
        destinations: [
          {
            chainId: 42161,
            token: WETH_ARB,
            recipient: ACCOUNT,
            minAmount: 1n,
          },
        ],
      },
      'ECO_IE moves only USD stablecoins; the `to` token',
    ],
  ] as const)('refuses %s', (_, overrides, message) => {
    expect(() =>
      scopeEco({ ...base, ...overrides } as SettlementContext),
    ).toThrow(message)
  })
})

describe('to.minAmount floors delivery in the `to` token', () => {
  const FLOOR = 98n * E6
  const cross = {
    ...base,
    maxFeeBps: undefined,
    cap: 100n * E6,
    destinations: [
      {
        chainId: 42161,
        token: USDT0_ARB,
        recipient: ACCOUNT,
        minAmount: FLOOR,
      },
    ],
  }
  const toUsdt = (delivered: bigint, reward = 100n * E6) =>
    publish({ routeToken: USDT0_ARB, delivered, reward })

  test('admits USDC to USDT0 at or above the floor, and refuses below it', () => {
    const action = scopeEco(cross)
    expect(floors(cross)).toEqual([FLOOR, FLOOR])
    expect(holds(action, toUsdt(FLOOR))).toBe(true)
    expect(holds(action, toUsdt(FLOOR + 1n))).toBe(true)
    expect(holds(action, toUsdt(FLOOR - 1n))).toBe(false)
  })

  test('needs no served decimals, only a token Eco serves', () => {
    const settlement = {
      ...SETTLEMENT_CATALOG,
      42161: { ...SETTLEMENT_CATALOG[42161], usdStablecoins: undefined },
    }
    expect(floors({ ...cross, settlement })).toEqual([FLOOR, FLOOR])
  })

  test.each([
    [
      'an unserved `from` token',
      { sourceTokens: [OTHER] },
      'ECO_IE moves only USD stablecoins; the `from` token on chain 8453',
    ],
    [
      'an unserved `to` token',
      {
        destinations: [
          { ...cross.destinations[0], token: WETH_ARB, minAmount: 1n },
        ],
      },
      'ECO_IE moves only USD stablecoins; the `to` token on chain 42161',
    ],
    [
      'an unserved second `to` token',
      {
        destinations: [
          cross.destinations[0],
          { chainId: 10, token: OTHER, recipient: ACCOUNT, minAmount: 1n },
        ],
      },
      'ECO_IE moves only USD stablecoins; the `to` token on chain 10',
    ],
  ] as const)('refuses %s even with a floor', (_, overrides, message) => {
    expect(() =>
      scopeEco({ ...cross, ...overrides } as SettlementContext),
    ).toThrow(message)
  })

  test.each([
    ['a minAmount above the fee floor', 99_500_000n, 99_500_000n],
    ['a minAmount below the fee floor', 60n * E6, 99n * E6],
    ['a minAmount equal to the fee floor', 99n * E6, 99n * E6],
  ])(
    'with maxFeeBps too, the stricter floor applies: %s',
    (_, minAmount, floor) => {
      const ctx = {
        ...base,
        cap: 100n * E6,
        destinations: [
          { chainId: 42161, token: USDC_ARB, recipient: ACCOUNT, minAmount },
        ],
      }
      expect(floors(ctx)).toEqual([floor, floor])
    },
  )

  test('each leg keeps its own floor', () => {
    const ctx = {
      ...cross,
      destinations: [
        cross.destinations[0],
        {
          chainId: 10,
          token: USDC_OP,
          recipient: ACCOUNT,
          minAmount: 97n * E6,
        },
      ],
    }
    const action = scopeEco(ctx)
    const toOp = (delivered: bigint) =>
      publish({
        destination: 10n,
        routeToken: USDC_OP,
        delivered,
        reward: 100n * E6,
      })
    expect(holds(action, toUsdt(FLOOR))).toBe(true)
    expect(holds(action, toUsdt(97n * E6))).toBe(false)
    expect(holds(action, toOp(97n * E6))).toBe(true)
    expect(holds(action, toOp(97n * E6 - 1n))).toBe(false)
  })

  test.each([
    [
      'a zero minAmount',
      { destinations: [{ ...cross.destinations[0], minAmount: 0n }] },
      'ECO_IE needs a positive `to.minAmount`',
    ],
    [
      'a negative minAmount',
      { destinations: [{ ...cross.destinations[0], minAmount: -1n }] },
      'ECO_IE needs a positive `to.minAmount`',
    ],
    [
      'a leg with no minAmount and no maxFeeBps',
      {
        destinations: [
          cross.destinations[0],
          { chainId: 10, token: USDC_OP, recipient: ACCOUNT },
        ],
      },
      'a `to.minAmount` on every leg',
    ],
    ['no cap', { cap: undefined }, 'ECO_IE needs maxAmount'],
    [
      'a bad maxFeeBps beside a minAmount',
      { maxFeeBps: 10_000 },
      'maxFeeBps must be an integer',
    ],
  ] as const)('refuses %s', (_, overrides, message) => {
    expect(() =>
      scopeEco({ ...cross, ...overrides } as SettlementContext),
    ).toThrow(message)
  })
})

describe('a hostile key filling its own intent', () => {
  const modes = {
    'maxFeeBps, 6 to 6': {
      ctx: { ...base, cap: 100n * E6 },
      token: USDC_ARB,
      floor: 99n * E6,
    },
    'maxFeeBps, 6 to 18': {
      ctx: {
        ...base,
        settlement: WITH_18,
        cap: 100n * E6,
        destinations: [
          { chainId: 42161, token: USD18_ARB, recipient: ACCOUNT },
        ],
      },
      token: USD18_ARB,
      floor: 99n * E18,
    },
    'maxFeeBps, 18 to 6': {
      ctx: {
        ...base,
        settlement: WITH_18,
        sourceTokens: [USD18_BASE],
        cap: 100n * E18,
      },
      token: USDC_ARB,
      floor: 99n * E6,
      reward: 100n * E18,
      rewardToken: USD18_BASE,
    },
    'maxFeeBps and a stricter to.minAmount': {
      ctx: {
        ...base,
        cap: 100n * E6,
        destinations: [
          {
            chainId: 42161,
            token: USDT0_ARB,
            recipient: ACCOUNT,
            minAmount: 99_500_000n,
          },
        ],
      },
      token: USDT0_ARB,
      floor: 99_500_000n,
    },
    'to.minAmount, USDC to USDT0': {
      ctx: {
        ...base,
        maxFeeBps: undefined,
        cap: 100n * E6,
        destinations: [
          {
            chainId: 42161,
            token: USDT0_ARB,
            recipient: ACCOUNT,
            minAmount: 98n * E6,
          },
        ],
      },
      token: USDT0_ARB,
      floor: 98n * E6,
    },
  }

  for (const [mode, m] of Object.entries(modes)) {
    const { ctx, token, floor } = m
    const { reward = 100n * E6, rewardToken = USDC_BASE } = m as {
      reward?: bigint
      rewardToken?: Address
    }
    describe(mode, () => {
      const action = scopeEco(ctx as SettlementContext)
      const fill = (o: Parameters<typeof publish>[0]) =>
        holds(action, publish({ routeToken: token, reward, rewardToken, ...o }))

      test('admits the honest publish', () => {
        expect(fill({ delivered: floor })).toBe(true)
      })

      test.each([
        ['delivers one unit for the whole cap', { delivered: 1n }],
        ['delivers nothing for the whole cap', { delivered: 0n }],
        ['delivers a unit under the floor', { delivered: floor - 1n }],
        ['rewards past the cap', { delivered: floor, reward: reward + 1n }],
        ['delivers to itself', { delivered: floor, recipient: OTHER }],
        [
          'delivers another token',
          { delivered: floor, routeToken: OTHER, callTarget: OTHER },
        ],
      ] as const)('refuses a publish that %s', (_, o) => {
        expect(fill(o)).toBe(false)
      })
    })
  }
})

describe('to.minAmount sanity', () => {
  const leg = { chainId: 42161, token: USDC_ARB, recipient: ACCOUNT }
  const twins = (a?: bigint, b?: bigint) => ({
    ...base,
    cap: 100n * E6,
    destinations: [
      { ...leg, minAmount: a },
      { ...leg, token: getAddress(leg.token), minAmount: b },
    ],
  })

  test.each([
    ['different floors', 99n * E6, 60n * E6],
    ['one floor missing', 99n * E6, undefined],
  ])('refuses the same leg twice with %s', (_, a, b) => {
    expect(() => scopeEco(twins(a, b))).toThrow(
      'twice with different `to.minAmount`',
    )
  })

  test('admits the same leg twice with the same floor', () => {
    expect(floors(twins(99n * E6, 99n * E6))).toContain(99n * E6)
  })
})
