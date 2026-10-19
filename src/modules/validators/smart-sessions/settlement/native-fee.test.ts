import {
  type Address,
  type Chain,
  encodeFunctionData,
  type Hex,
  pad,
} from 'viem'
import { arbitrum, base, optimism, plasma, soneium } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { accountA } from '../../../../../test/consts'
import { admits, install } from '../../../../../test/utils/installed-policies'
import {
  ACCOUNT,
  CAP,
  cctp,
  execute,
  OTHER,
  SONEIUM_EID,
  stargate,
  USDC_ARB,
  USDC_BASE,
  USDC_PLASMA,
  USDC_SONEIUM,
} from '../../../../../test/utils/lz-calldata'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { getSessionDetails, hasLifetimeBudget } from '../authorization'
import {
  DEFAULT_POLICY_ADDRESSES,
  UNIVERSAL_ACTION_POLICY_COPIES,
} from '../policies/addresses'
import {
  resolveSessionData,
  toSession,
  validateSessionDefinition,
} from '../resolve'
import type {
  CrossChainPermissionInput,
  Session,
  SessionDefinition,
} from '../types'
import { LZ_EXECUTE_SELECTOR } from './lz'
import { OFT_SEND_SELECTOR, oftAbi } from './oft'

// These tests assume the TimeFramePolicy is deployed on their chains.
vi.mock('../policies/addresses', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../policies/addresses')>()),
  timeFramePolicyDeployed: () => true,
}))

const OPTIONS = { settlement: SETTLEMENT_CATALOG }
const KINDS = {
  universalAction: [
    DEFAULT_POLICY_ADDRESSES.universalAction,
    ...UNIVERSAL_ACTION_POLICY_COPIES,
  ],
  argPolicy: DEFAULT_POLICY_ADDRESSES.argPolicy,
  valueLimit: DEFAULT_POLICY_ADDRESSES.valueLimit,
}
/** About ten Stargate fees, in wei. */
const BUDGET = 1_200_000_000_000_000n
const FEE = 110_176_109_085_186n
const USDT0_ARB = SETTLEMENT_CATALOG[arbitrum.id].oft!.token
const USDT0_PLASMA = SETTLEMENT_CATALOG[plasma.id].oft!.token

const ARB_LEG = { chain: arbitrum, token: USDC_ARB }
const SONEIUM_LEG = { chain: soneium, token: USDC_SONEIUM }
const PLASMA_LEG = { chain: plasma, token: USDC_PLASMA }

function definition(
  permit: Partial<CrossChainPermissionInput>,
  extra: Partial<SessionDefinition> = {},
  chain: Chain = base,
): SessionDefinition {
  return {
    chain,
    owners: { type: 'ecdsa', accounts: [accountA] },
    account: ACCOUNT,
    crossChainPermits: [
      {
        from: {
          chain: base,
          token: USDC_BASE,
          maxAmount: CAP,
          maxNativeFee: BUDGET,
        },
        to: ARB_LEG,
        settlementLayers: ['LZ'],
        ...permit,
      },
    ],
    ...extra,
  } as SessionDefinition
}

const once = {
  oneTimeUse: { id: 7n },
  policyAddresses: {
    oneTimeUseId: '0x3333333333333333333333333333333333333333',
  },
} as const satisfies Partial<SessionDefinition>

const codes = (def: SessionDefinition) =>
  validateSessionDefinition(def, OPTIONS).refusals.map(({ code }) => code)

/** The layer call, installed once: every intent then draws on its counters. */
function installed(
  def: SessionDefinition,
  selector: Hex = LZ_EXECUTE_SELECTOR,
) {
  const actions = resolveSessionData(def, OPTIONS).actions.filter(
    (a) => a.actionTargetSelector === selector,
  )
  expect(actions).toHaveLength(1)
  return install(actions[0].actionPolicies, KINDS)
}

describe('LZ on a reusable session', () => {
  test('is refused without maxNativeFee', () => {
    const def = definition({
      from: { chain: base, token: USDC_BASE, maxAmount: CAP },
    })
    expect(codes(def)).toContain('LAYER_REQUIRES_ONE_TIME_USE')
  })

  test('runs again and again within maxNativeFee', () => {
    const lz = installed(definition({}))
    for (let i = 0; i < 3; i++) {
      expect(admits(lz, execute(cctp({ pull: 1n, fee: 0n })), FEE)).toBe(true)
    }
  })

  test('refuses a send once the fees reach maxNativeFee', () => {
    const lz = installed(definition({}))
    expect(admits(lz, execute(cctp({ pull: 1n, fee: 0n })), BUDGET - 1n)).toBe(
      true,
    )
    expect(admits(lz, execute(cctp({ pull: 1n, fee: 0n })), 2n)).toBe(false)
    expect(admits(lz, execute(cctp({ pull: 1n, fee: 0n })), 1n)).toBe(true)
  })

  test('refuses one send whose value is above maxNativeFee', () => {
    const lz = installed(definition({}))
    expect(admits(lz, execute(cctp({ pull: 1n, fee: 0n })), BUDGET + 1n)).toBe(
      false,
    )
    expect(admits(lz, execute(cctp({ pull: 1n, fee: 0n })), BUDGET)).toBe(true)
  })

  test('counts every route on one pull counter, so a stale allowance moves no more than maxAmount', () => {
    // Stargate into Soneium and CCTP into Plasma are both four-call batches.
    const lz = installed(definition({ to: [SONEIUM_LEG, PLASMA_LEG] }))
    const taxi = (amount: bigint) =>
      execute(stargate('taxi', { eid: SONEIUM_EID, amount, minAmount: 0n }))
    const feeless = (pull: bigint) => execute(cctp({ pull, domain: 33 }, true))
    expect(admits(lz, taxi(CAP - 1n), FEE)).toBe(true)
    expect(admits(lz, feeless(2n))).toBe(false)
    expect(admits(lz, feeless(1n))).toBe(true)
    expect(admits(lz, taxi(1n), FEE)).toBe(false)
  })

  test('refuses capped legs that need batches of different shapes', () => {
    expect(codes(definition({ to: [ARB_LEG, SONEIUM_LEG] }))).toContain(
      'LZ_REUSABLE_ROUTES_SPLIT',
    )
    expect(
      codes(
        definition({
          from: { chain: base, token: USDC_BASE, maxNativeFee: BUDGET },
          to: [ARB_LEG, SONEIUM_LEG],
        }),
      ),
    ).toEqual([])
  })

  test('keeps the recipient, destination and pull pinned', () => {
    const lz = installed(definition({}))
    expect(admits(lz, execute(cctp({ pull: 1n, fee: 0n, to: OTHER })))).toBe(
      false,
    )
    expect(admits(lz, execute(cctp({ pull: 1n, fee: 0n, domain: 0 })))).toBe(
      false,
    )
    expect(admits(lz, execute(cctp({ pull: CAP + 1n, fee: 0n })))).toBe(false)
    expect(admits(lz, execute(cctp({ pull: CAP, fee: 0n })))).toBe(true)
    expect(admits(lz, execute(cctp({ pull: 1n, fee: 0n })))).toBe(false)
  })

  test('is a lifetime budget, from its metadata and from its actions', () => {
    const def = definition({
      from: { chain: base, token: USDC_BASE, maxNativeFee: BUDGET },
    })
    const session = toSession(def, OPTIONS)
    expect(session.lifetimeBudget).toBe(true)
    const { lifetimeBudget: _, ...stored } = session
    expect(hasLifetimeBudget(stored, 'production')).toBe(true)
  })
})

describe('maxNativeFee on a one-time-use session', () => {
  test('caps the one send, which still runs once', () => {
    const lz = installed(definition({}, once))
    expect(admits(lz, execute(cctp({ pull: 1n, fee: 0n })), BUDGET + 1n)).toBe(
      false,
    )
    expect(admits(lz, execute(cctp({ pull: 1n, fee: 0n })), FEE)).toBe(true)
    expect(admits(lz, execute(cctp({ pull: 1n, fee: 0n })), FEE)).toBe(false)
  })
})

describe('maxNativeFee refusals', () => {
  test.each<[string, SessionDefinition, string]>([
    [
      'two budgets on one chain',
      definition({
        from: [
          { chain: base, token: USDC_BASE, maxNativeFee: BUDGET },
          { chain: base, token: OTHER, maxNativeFee: BUDGET },
        ],
      }),
      'MULTIPLE_MAX_NATIVE_FEES',
    ],
    [
      'a zero budget',
      definition({
        from: {
          chain: base,
          token: USDC_BASE,
          maxAmount: CAP,
          maxNativeFee: 0n,
        },
      }),
      'MAX_NATIVE_FEE_NOT_POSITIVE',
    ],
    [
      'a layer that pays no native fee',
      definition({ settlementLayers: ['CCTP'] }),
      'MAX_NATIVE_FEE_NOT_APPLICABLE',
    ],
    [
      'a Permit2-layer permit',
      definition({ settlementLayers: ['ACROSS'] }, once),
      'MAX_NATIVE_FEE_NOT_APPLICABLE',
    ],
    [
      'SAME_CHAIN_IE',
      definition({
        to: { chain: base, token: USDC_BASE, recipient: OTHER },
        allowRecipientNotAccount: true,
        settlementLayers: ['SAME_CHAIN_IE'],
      }),
      'MAX_NATIVE_FEE_NOT_APPLICABLE',
    ],
  ])('refuses %s', (_, def, code) => {
    expect(codes(def)).toContain(code)
  })
})

describe('OFT on a reusable session', () => {
  const send = (o: Partial<{ to: Address; amount: bigint }> = {}) =>
    encodeFunctionData({
      abi: oftAbi,
      functionName: 'send',
      args: [
        {
          dstEid: SETTLEMENT_CATALOG[plasma.id].oft!.eid,
          to: pad(o.to ?? ACCOUNT),
          amountLD: o.amount ?? 1n,
          minAmountLD: 0n,
          extraOptions: '0x',
          composeMsg: '0x',
          oftCmd: '0x',
        },
        { nativeFee: FEE, lzTokenFee: 0n },
        ACCOUNT,
      ],
    })
  const oft = (permit: Partial<CrossChainPermissionInput> = {}) =>
    definition(
      {
        from: {
          chain: arbitrum,
          token: USDT0_ARB,
          maxAmount: CAP,
          maxNativeFee: BUDGET,
        },
        to: { chain: plasma, token: USDT0_PLASMA },
        settlementLayers: ['OFT'],
        ...permit,
      },
      {},
      arbitrum,
    )

  test('is refused without maxNativeFee', () => {
    expect(
      codes(
        oft({ from: { chain: arbitrum, token: USDT0_ARB, maxAmount: CAP } }),
      ),
    ).toContain('LAYER_REQUIRES_ONE_TIME_USE')
  })

  test('sends again within maxNativeFee and maxAmount, and no further', () => {
    const action = installed(oft(), OFT_SEND_SELECTOR)
    expect(admits(action, send({ to: OTHER }), FEE)).toBe(false)
    expect(admits(action, send(), FEE)).toBe(true)
    expect(admits(action, send(), FEE)).toBe(true)
    expect(admits(action, send(), BUDGET)).toBe(false)
    expect(admits(action, send({ amount: CAP - 1n }))).toBe(false)
    expect(admits(action, send({ amount: CAP - 2n }))).toBe(true)
  })
})

describe('a stored reusable LZ or OFT session without the lifetimeBudget flag', () => {
  // Another ValueLimitPolicy deployment, as a policyAddresses override sets.
  const VALUE_LIMIT = '0x9999999999999999999999999999999999999999' as Address
  const stored = (def: SessionDefinition): Session => {
    const { lifetimeBudget: _, ...rest } = toSession(
      { ...def, policyAddresses: { valueLimit: VALUE_LIMIT } },
      OPTIONS,
    )
    return rest
  }
  const lz = stored(
    definition({
      from: { chain: base, token: USDC_BASE, maxNativeFee: BUDGET },
    }),
  )
  const oft = stored(
    definition(
      {
        from: { chain: arbitrum, token: USDT0_ARB, maxNativeFee: BUDGET },
        to: { chain: plasma, token: USDT0_PLASMA },
        settlementLayers: ['OFT'],
      },
      {},
      arbitrum,
    ),
  )

  test.each([
    ['LZ', lz],
    ['OFT', oft],
  ])('%s still holds a budget an enable would reset', async (_, session) => {
    expect(
      session.actions.some((a) =>
        a.actionPolicies.some(
          ({ policy }) => policy.toLowerCase() === VALUE_LIMIT,
        ),
      ),
    ).toBe(true)
    expect(hasLifetimeBudget(session, 'production')).toBe(true)
    await expect(
      getSessionDetails({
        account: ACCOUNT,
        sessions: [session],
        environment: 'production',
        readNonce: async () => 0n,
        readNonceAndEnabled: async () => ({ nonce: 0n, enabled: true }),
      }),
    ).rejects.toThrow(/its maxNativeFee is a lifetime budget:/)
  })

  test('a one-time-use LZ session holds none', () => {
    const session = toSession(definition({}, once), OPTIONS)
    expect(hasLifetimeBudget(session, 'production')).toBe(false)
  })
})

test('the re-enable refusal names every budget the session holds', async () => {
  await expect(
    getSessionDetails({
      account: ACCOUNT,
      sessions: [toSession(definition({}), OPTIONS)],
      environment: 'production',
      readNonce: async () => 0n,
      readNonceAndEnabled: async () => ({ nonce: 0n, enabled: true }),
    }),
  ).rejects.toThrow(/its maxAmount and maxNativeFee are lifetime budgets:/)
})

describe('maxNativeFee across tokens', () => {
  const USDC_OP = SETTLEMENT_CATALOG[optimism.id].cctp!.usdc
  const USDT0_OP = SETTLEMENT_CATALOG[optimism.id].oft!.token
  const WETH = '0x4200000000000000000000000000000000000006' as Address
  const VALUE_LIMIT = DEFAULT_POLICY_ADDRESSES.valueLimit
  /** USDC and USDT0 on Optimism, which CCTP, LZ (USDC) and OFT (USDT0) move. */
  const stables = (
    usdc: { maxAmount?: bigint; maxNativeFee?: bigint },
    usdt0: { maxNativeFee?: bigint } = {},
    extra: Partial<SessionDefinition> = {},
  ) =>
    definition(
      {
        from: [
          { chain: optimism, token: USDC_OP, ...usdc },
          { chain: optimism, token: USDT0_OP, ...usdt0 },
        ],
        to: [
          { chain: arbitrum, token: USDC_ARB },
          { chain: arbitrum, token: USDT0_ARB },
        ],
        settlementLayers: 'all',
      },
      extra,
      optimism,
    )
  /** The value-limit budget on each fee-paying call the session holds. */
  const budgets = (def: SessionDefinition) =>
    resolveSessionData(def, OPTIONS)
      .actions.filter(
        (a) =>
          a.actionTargetSelector === LZ_EXECUTE_SELECTOR ||
          a.actionTargetSelector === OFT_SEND_SELECTOR,
      )
      .map((a) => ({
        selector: a.actionTargetSelector,
        budget: a.actionPolicies.some(
          ({ policy }) => policy.toLowerCase() === VALUE_LIMIT.toLowerCase(),
        ),
      }))

  test("refuses rather than let 'all' drop both OFT and LZ under a budget", () => {
    for (const extra of [{}, once]) {
      const def = stables({ maxNativeFee: BUDGET }, {}, extra)
      expect(codes(def)).toContain('MAX_NATIVE_FEE_NOT_APPLICABLE')
      expect(() => toSession(def, OPTIONS)).toThrow(
        /maxNativeFee applies only to LZ and OFT, and 'all' keeps neither here: OFT and LZ each pay/,
      )
    }
    // Without a budget, 'all' keeps neither, as before.
    expect(
      toSession(stables({}, {}, once), OPTIONS).settlementLayers,
    ).not.toContain('LZ')
  })

  test('the budget goes on the fee-paying layer the capped token keeps', () => {
    // maxAmount on USDC: OFT (USDT0) is dropped and LZ (USDC) is kept.
    for (const def of [
      stables({ maxAmount: CAP, maxNativeFee: BUDGET }),
      stables({ maxAmount: CAP }, { maxNativeFee: BUDGET }),
    ]) {
      expect(toSession(def, OPTIONS).settlementLayers).toContain('LZ')
      expect(budgets(def)).toEqual([
        { selector: LZ_EXECUTE_SELECTOR, budget: true },
      ])
    }
  })

  test('a reusable fee-paying layer is kept only with a budget', () => {
    const without = toSession(stables({ maxAmount: CAP }), OPTIONS)
    expect(without.settlementLayers).not.toContain('LZ')
    expect(
      without.settlementCoverage?.dropped.find(({ layer }) => layer === 'LZ')
        ?.reason,
    ).toContain('requires oneTimeUse or a maxNativeFee')
    expect(
      toSession(stables({ maxAmount: CAP, maxNativeFee: BUDGET }), OPTIONS)
        .settlementLayers,
    ).toContain('LZ')
  })

  test('refuses a budget whose fee-paying layer keeps no leg', () => {
    // LZ moves USDC on Base and OFT moves USDT0 on Arbitrum; neither delivers
    // these legs, so their projections are empty.
    for (const def of [
      definition({
        from: { chain: base, token: USDC_BASE, maxNativeFee: BUDGET },
        to: { chain: arbitrum, token: USDT0_ARB },
        settlementLayers: 'all',
      }),
      definition(
        {
          from: { chain: arbitrum, token: USDT0_ARB, maxNativeFee: BUDGET },
          to: { chain: plasma, token: USDC_PLASMA },
          settlementLayers: 'all',
        },
        {},
        arbitrum,
      ),
    ]) {
      expect(codes(def)).toContain('MAX_NATIVE_FEE_NOT_APPLICABLE')
    }
  })

  test('refuses a budget when LZ cannot pin any of its legs', () => {
    // LZ moves this leg's token but cannot pin it alone: its floor sits on a
    // CCTP route, so LZ keeps no pinned leg and is not kept.
    const def = definition({
      from: {
        chain: base,
        token: USDC_BASE,
        maxAmount: CAP,
        maxNativeFee: BUDGET,
      },
      to: { chain: arbitrum, token: USDC_ARB, minAmount: CAP / 2n },
      settlementLayers: 'all',
      maxFeeBps: 100,
      validUntil: new Date(Date.now() + 8 * 86_400_000),
    })
    expect(codes(def)).toContain('MAX_NATIVE_FEE_NOT_APPLICABLE')
    // Without the budget and with oneTimeUse, 'all' builds and drops LZ for
    // that leg alone.
    const session = toSession(
      {
        ...def,
        ...once,
        crossChainPermits: [
          {
            ...def.crossChainPermits![0],
            from: { chain: base, token: USDC_BASE, maxAmount: CAP },
          },
        ],
      },
      OPTIONS,
    )
    expect(session.settlementLayers).not.toContain('LZ')
    expect(
      session.settlementCoverage?.dropped.find(({ layer }) => layer === 'LZ')
        ?.reason,
    ).toMatch(/CCTP/)
  })

  test('refuses a budget when the cap on another token drops LZ', () => {
    const def = definition({
      from: [
        { chain: base, token: USDC_BASE, maxNativeFee: BUDGET },
        { chain: base, token: WETH, maxAmount: 10n ** 18n },
      ],
      settlementLayers: 'all',
    })
    expect(codes(def)).toContain('MAX_NATIVE_FEE_NOT_APPLICABLE')
  })

  test('the shared LZ pull cap counts in the capped token beside another token', () => {
    const lz = installed(
      definition({
        from: [
          {
            chain: base,
            token: USDC_BASE,
            maxAmount: CAP,
            maxNativeFee: BUDGET,
          },
          { chain: base, token: WETH },
        ],
        settlementLayers: ['ACROSS', 'LZ'],
      }),
    )
    expect(admits(lz, execute(cctp({ pull: CAP - 1n, fee: 0n })), FEE)).toBe(
      true,
    )
    expect(admits(lz, execute(cctp({ pull: 2n, fee: 0n })), FEE)).toBe(false)
    expect(admits(lz, execute(cctp({ pull: 1n, fee: 0n })), FEE)).toBe(true)
  })
})
