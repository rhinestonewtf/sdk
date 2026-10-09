import {
  type Abi,
  type Address,
  type Chain,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  isAddressEqual,
  maxUint256,
  pad,
  toFunctionSelector,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../test/consts'
import { satisfiesRules } from '../../../../test/utils/policy-rules'
import { SETTLEMENT_CATALOG } from '../../../../test/utils/settlement-catalog'
import { PERMIT2_CLAIM_POLICY_ADDRESS } from '../policies/claim/permit2'
import { FIELD_ORIGIN_OPS } from '../policies/claim/types'
import { getSessionData } from './digest'
import { CONSUME_SELECTOR } from './one-time-use'
import {
  INTENT_EXECUTION_POLICY_ADDRESS,
  SPENDING_LIMITS_POLICY_ADDRESS,
  SUDO_POLICY_ADDRESS,
  VALUE_LIMIT_POLICY_ADDRESS,
} from './policies/addresses'
import { encodeActionPolicies } from './policies/encode'
import {
  permit2FallbackScope,
  permit2RouteScope,
  permit2SourceTokens,
} from './policies/permit2-approval'
import {
  DEFAULT_POLICY_ADDRESSES,
  DUMMY_PRECLAIMOP_TARGET,
  type ResolveSessionOptions,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  toSession,
  validateSessionDefinition,
} from './resolve'
import { CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR } from './settlement/fees'
import type { SettlementCatalog } from './settlement/types'
import { cumulativeCap, pin, swapAction } from './swap/rules'
import { PERMIT2 } from './swap/stable-floor'
import type {
  CrossChainPermissionInput,
  CrossChainPermit,
  Permission,
  ResolvedAction,
  ScopedAction,
  SessionDefinition,
} from './types'

const USDC = SETTLEMENT_CATALOG[base.id].cctp!.usdc
const USDC_ARB = SETTLEMENT_CATALOG[arbitrum.id].cctp!.usdc
const USDT = '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2' as Address
const WETH = '0x4200000000000000000000000000000000000006' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
const COLLECTOR = '0x5555555555555555555555555555555555555555' as Address
const PAYMASTER = '0x6666666666666666666666666666666666666666' as Address
const APPROVE = toFunctionSelector('approve(address,uint256)')
const TRANSFER = toFunctionSelector('transfer(address,uint256)')
const DEPOSIT = toFunctionSelector('deposit()')
const WITH_FEES: SettlementCatalog = {
  ...SETTLEMENT_CATALOG,
  [base.id]: {
    ...SETTLEMENT_CATALOG[base.id],
    fees: { appFeeCollector: COLLECTOR, paymaster: PAYMASTER },
  },
}
const OPTIONS: ResolveSessionOptions = { settlement: WITH_FEES }
const otu = {
  oneTimeUse: { id: 7n },
  policyAddresses: { oneTimeUseId: ONE_TIME_USE },
} as const

/** A reusable scoped permit: its claim may not carry pre-claim calls. */
const permit = (
  extra: Partial<CrossChainPermissionInput> = {},
): CrossChainPermissionInput => ({
  from: { chain: base, token: USDC },
  to: { chain: arbitrum, token: USDC_ARB },
  settlementLayers: ['ACROSS'],
  preClaimOps: 'none',
  ...extra,
})

/** A one-time-use permit, which bounds its pre-claim calls by the once-policy. */
const oncePermit = (extra: Partial<CrossChainPermissionInput> = {}) =>
  permit({ preClaimOps: undefined, ...extra })

const session = (
  permits: CrossChainPermissionInput[],
  extra: Partial<SessionDefinition> = {},
): SessionDefinition => ({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  account: ACCOUNT,
  crossChainPermits: permits,
  ...extra,
})

const approve = (spender: Address, amount: bigint): Hex =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  })

const codes = (definition: SessionDefinition, options = OPTIONS) =>
  validateSessionDefinition(definition, options).refusals.map(
    ({ code }) => code,
  )

const actionOn = (
  actions: readonly ResolvedAction[],
  target: Address,
  selector: Hex,
) =>
  actions.find(
    (a) =>
      isAddressEqual(a.actionTarget, target) &&
      a.actionTargetSelector === selector,
  )

const fallbackOf = (definition: SessionDefinition) =>
  actionOn(
    toSession(definition, OPTIONS).actions,
    SMART_SESSIONS_FALLBACK_TARGET_FLAG,
    '0x00000001',
  )

const encoded = (action: ScopedAction) =>
  encodeActionPolicies(
    action.policies ?? [],
    'production',
    DEFAULT_POLICY_ADDRESSES,
  )

const resolved = (
  legs: CrossChainPermit['from'],
): readonly CrossChainPermit[] => [{ from: legs }]

describe('the actions a Permit2-route permit scopes', () => {
  const only = (cap?: bigint) =>
    permit2RouteScope(new Map([[USDC, cap]]), [], [], undefined)

  test('is one approve on the token, its spender pinned to Permit2', () => {
    const actions = only()
    expect(actions.map(({ target, selector }) => [target, selector])).toEqual([
      [USDC, APPROVE],
    ])
    expect(satisfiesRules(actions[0], approve(PERMIT2, maxUint256))).toBe(true)
    expect(satisfiesRules(actions[0], approve(OTHER, 1n))).toBe(false)
  })

  test('caps what it approves across calls at maxAmount', () => {
    const [action] = only(100n)
    expect(satisfiesRules(action, approve(PERMIT2, 101n))).toBe(false)
    expect(satisfiesRules(action, approve(PERMIT2, 100n))).toBe(true)
    // The cap is cumulative, so a second approve cannot grant it again.
    expect(satisfiesRules(action, approve(PERMIT2, 41n), 60n)).toBe(false)
    expect(satisfiesRules(action, approve(PERMIT2, 40n), 60n)).toBe(true)
    expect(satisfiesRules(only()[0], approve(PERMIT2, 41n), 60n)).toBe(true)
  })

  test('takes the largest maxAmount of the legs on the chain, or none', () => {
    const leg = (token: Address, maxAmount?: bigint, chain: Chain = base) => ({
      chain,
      token,
      ...(maxAmount === undefined ? {} : { maxAmount }),
    })
    expect(
      permit2SourceTokens(
        resolved([
          leg(USDC, 10n),
          leg(USDC.toLowerCase() as Address, 30n),
          leg(USDC, 20n),
          leg(WETH, 5n, arbitrum),
        ]),
        base.id,
      ),
    ).toEqual(new Map([[USDC, 30n]]))
    for (const legs of [
      [leg(USDC, 10n), leg(USDC)],
      [leg(USDC), leg(USDC, 10n)],
    ]) {
      expect(permit2SourceTokens(resolved(legs), base.id)).toEqual(
        new Map([[USDC, undefined]]),
      )
    }
  })

  test('refuses any declared approve on the token', () => {
    const declared = (params?: object): Permission =>
      ({
        abi: erc20Abi as Abi,
        address: USDC,
        functions: { approve: params ? { params } : {} },
      }) as Permission
    for (const permission of [
      declared(),
      declared({ spender: { condition: 'equal', value: OTHER } }),
      declared({ spender: { anyOf: [OTHER, PERMIT2] } }),
    ]) {
      expect(() =>
        permit2RouteScope(
          new Map([[USDC, undefined]]),
          [permission],
          [],
          undefined,
        ),
      ).toThrow(expect.objectContaining({ code: 'PERMIT2_APPROVE_CONFLICT' }))
    }
    expect(() =>
      permit2RouteScope(
        new Map([[USDC, undefined]]),
        [],
        [{ target: USDC, selector: APPROVE }],
        undefined,
      ),
    ).toThrow(expect.objectContaining({ code: 'PERMIT2_APPROVE_CONFLICT' }))
  })

  test('wraps the wrapped native token within its cap', () => {
    const [, deposit] = permit2RouteScope(
      new Map([[WETH, 5n]]),
      [],
      [],
      undefined,
      { token: WETH, cap: 5n },
    )
    expect(deposit).toEqual({
      target: WETH,
      selector: DEPOSIT,
      policies: [{ type: 'value-limit', limit: 5n }],
    })
  })
})

describe('a scoped Permit2-route session', () => {
  test("with preClaimOps: 'none' is its approve and a claim that may not carry pre-claim calls", () => {
    const built = toSession(session([permit()]), {
      ...OPTIONS,
      wrappedNativeToken: WETH,
    })
    expect(built.access).toEqual({
      kind: 'scoped',
      reason: 'Permit2-route permit (ACROSS)',
    })
    expect(
      built.actions.map(({ actionTarget, actionTargetSelector }) => [
        actionTarget,
        actionTargetSelector,
      ]),
    ).toEqual([
      [USDC, APPROVE],
      [DUMMY_PRECLAIMOP_TARGET, '0x69123456'],
    ])
    // The dummy op is value-capped, not sudo, as in any scoped session.
    expect(built.actions[1].actionPolicies.map((p) => p.policy)).toEqual([
      VALUE_LIMIT_POLICY_ADDRESS,
    ])
    expect(built.actions[0].actionPolicies).toEqual(
      encoded(swapAction(USDC, APPROVE, [pin(0n, PERMIT2)])),
    )
    expect(built.hasExplicitPermissions).toBe(true)
    expect(built.settlementLayers).toEqual(['ACROSS'])
    expect(built.claimPolicies[0].originOps).toEqual([
      { chain: base, required: false },
    ])
    // The claim policy reads it as origin ops not required on the session chain.
    const data = getSessionData(built)
    expect(data.erc7739Policies.allowedERC7739Content).toEqual([
      { appDomainSeparator: zeroHash, contentNames: [''] },
    ])
    const [claim] = data.erc7739Policies.erc1271Policies
    expect(claim.policy).toBe(PERMIT2_CLAIM_POLICY_ADDRESS)
    const modeConfig = Number.parseInt(claim.initData.slice(2, 10), 16)
    expect((modeConfig >> (FIELD_ORIGIN_OPS * 2)) & 0b11).toBe(0b01)
    expect(claim.initData.endsWith(`01${pad(toHex(base.id)).slice(2)}00`)).toBe(
      true,
    )
  })

  test('with oneTimeUse burns its id and caps its approve at maxAmount', () => {
    const built = toSession(
      session(
        [oncePermit({ from: { chain: base, token: USDC, maxAmount: 5n } })],
        otu,
      ),
      OPTIONS,
    )
    expect(built.access?.kind).toBe('scoped')
    expect(
      actionOn(built.actions, ONE_TIME_USE, CONSUME_SELECTOR),
    ).toBeDefined()
    expect(built.claimPolicies[0].originOps).toBeUndefined()
    // Built independently of the SDK's scoping, then checked against the session.
    const expected = swapAction(USDC, APPROVE, [
      pin(0n, PERMIT2),
      cumulativeCap(32n, 5n),
    ])
    expect(
      actionOn(built.actions, USDC, APPROVE)?.actionPolicies.slice(0, -1),
    ).toEqual(encoded(expected))
    expect(satisfiesRules(expected, approve(PERMIT2, 6n))).toBe(false)
    expect(satisfiesRules(expected, approve(PERMIT2, 5n))).toBe(true)
    expect(fallbackOf(session([oncePermit()], otu))).toBeUndefined()
  })

  test('pays fees with allowFees', () => {
    const built = toSession(
      session([oncePermit({ allowFees: true })], otu),
      OPTIONS,
    )
    expect(actionOn(built.actions, USDC, TRANSFER)).toBeDefined()
    expect(
      actionOn(built.actions, PAYMASTER, CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR),
    ).toBeDefined()
    expect(built.access?.kind).toBe('scoped')
    const plain = toSession(session([permit()]), OPTIONS)
    expect(actionOn(plain.actions, USDC, TRANSFER)).toBeUndefined()
  })

  test('wraps native funding only within a wrapped native `from` cap', () => {
    const wrapping = (from: { token: Address; maxAmount?: bigint }) =>
      toSession(
        session([oncePermit({ from: { chain: base, ...from } })], otu),
        { ...OPTIONS, wrappedNativeToken: WETH },
      ).actions
    expect(
      actionOn(wrapping({ token: WETH, maxAmount: 5n }), WETH, DEPOSIT)
        ?.actionPolicies[0],
    ).toEqual({
      policy: VALUE_LIMIT_POLICY_ADDRESS,
      initData: pad(toHex(5n)),
    })
    // Never a deposit without a cap, nor for another token.
    expect(actionOn(wrapping({ token: WETH }), WETH, DEPOSIT)).toBeUndefined()
    expect(
      actionOn(wrapping({ token: USDC, maxAmount: 5n }), WETH, DEPOSIT),
    ).toBeUndefined()
  })

  test('with a fallback keeps only the unscoped deposit it had before', () => {
    const actions = toSession(
      session(
        [oncePermit({ from: { chain: base, token: WETH, maxAmount: 5n } })],
        { fallback: 'intentExecution', ...otu },
      ),
      { ...OPTIONS, wrappedNativeToken: WETH },
    ).actions
    // Sudo, then the once-policy every action carries.
    expect(
      actionOn(actions, WETH, DEPOSIT)?.actionPolicies.map((p) => p.policy),
    ).toEqual([SUDO_POLICY_ADDRESS, ONE_TIME_USE])
  })

  test.each<[string, SessionDefinition, ResolveSessionOptions, string]>([
    [
      'a permit without oneTimeUse, preClaimOps or fallback',
      session([oncePermit()]),
      OPTIONS,
      'PERMIT2_ROUTE_NEEDS_BOUND',
    ],
    [
      'restrictToActions without a bound either',
      session([oncePermit()], {
        restrictToActions: true,
        actions: [{ target: OTHER, selector: '0x12345678' }],
      }),
      OPTIONS,
      'PERMIT2_ROUTE_NEEDS_BOUND',
    ],
    [
      "preClaimOps: 'none' beside oneTimeUse",
      session([permit()], otu),
      OPTIONS,
      'PRE_CLAIM_OPS_NOT_APPLICABLE',
    ],
    [
      "preClaimOps: 'none' on an IntentExecutor-layer permit",
      session([permit({ settlementLayers: ['CCTP'] })]),
      OPTIONS,
      'PRE_CLAIM_OPS_NOT_APPLICABLE',
    ],
    [
      'a native `from` token',
      session([permit({ from: { chain: base, token: zeroAddress } })]),
      OPTIONS,
      'NATIVE_SOURCE_UNSUPPORTED',
    ],
    [
      "preClaimOps: 'none' beside allowFees",
      session([permit({ allowFees: true })]),
      OPTIONS,
      'PRE_CLAIM_OPS_NOT_APPLICABLE',
    ],
    [
      'allowFees without the catalog',
      session([oncePermit({ allowFees: true })], otu),
      {},
      'ALLOW_FEES_CATALOG_MISSING',
    ],
    [
      'allowFees on a token that is not a served stablecoin',
      session(
        [oncePermit({ allowFees: true, from: { chain: base, token: WETH } })],
        otu,
      ),
      OPTIONS,
      'ALLOW_FEES_NON_STABLECOIN',
    ],
    [
      'a native `to` token',
      session([permit({ to: { chain: arbitrum, token: zeroAddress } })]),
      OPTIONS,
      'NATIVE_DESTINATION_UNSUPPORTED',
    ],
    [
      'a wrapped native `from` leg capped at 0',
      session(
        [oncePermit({ from: { chain: base, token: WETH, maxAmount: 0n } })],
        otu,
      ),
      { ...OPTIONS, wrappedNativeToken: WETH },
      'WRAPPED_NATIVE_ZERO_CAP',
    ],
    [
      'a permit without `from`',
      session([permit({ from: undefined })]),
      OPTIONS,
      'PERMIT2_ROUTE_NEEDS_FROM',
    ],
    [
      "a permit without `from` on the session's chain",
      session([permit({ from: { chain: arbitrum, token: USDC_ARB } })]),
      OPTIONS,
      'PERMIT2_ROUTE_NEEDS_FROM',
    ],
    [
      'allowFees without `from`, even with an intentExecution fallback',
      session([oncePermit({ from: undefined, allowFees: true })], {
        fallback: 'intentExecution',
      }),
      OPTIONS,
      'PERMIT2_ROUTE_NEEDS_FROM',
    ],
    [
      'a SAME_CHAIN-only permit',
      session([permit({ settlementLayers: ['SAME_CHAIN'] })]),
      OPTIONS,
      'PERMIT2_ROUTE_ACROSS_ONLY',
    ],
    [
      'SAME_CHAIN beside ACROSS',
      session([permit({ settlementLayers: ['ACROSS', 'SAME_CHAIN'] })]),
      OPTIONS,
      'PERMIT2_ROUTE_ACROSS_ONLY',
    ],
    [
      'an ECO-only permit',
      session([permit({ settlementLayers: ['ECO'] })]),
      OPTIONS,
      'RETIRED_PERMIT2_LAYER',
    ],
    [
      'a permit naming ECO beside live layers',
      session([permit({ settlementLayers: ['ACROSS', 'SAME_CHAIN', 'ECO'] })]),
      OPTIONS,
      'RETIRED_PERMIT2_LAYER',
    ],
    [
      'a permit naming ECO, even with a fallback',
      session([permit({ settlementLayers: ['ECO'] })], { fallback: 'sudo' }),
      OPTIONS,
      'RETIRED_PERMIT2_LAYER',
    ],
  ])('refuses %s', (_, definition, options, code) => {
    expect(codes(definition, options)).toEqual([code])
    expect(() => toSession(definition, options)).toThrow(
      expect.objectContaining({ code }),
    )
  })

  test.each<[CrossChainPermissionInput['settlementLayers'], string[]]>([
    [['ACROSS'], ['ACROSS']],
    [undefined, ['ACROSS']],
    [[], ['ACROSS']],
  ])('naming %j settles through %j', (settlementLayers, layers) => {
    const built = toSession(session([permit({ settlementLayers })]), OPTIONS)
    expect(built.access).toEqual({
      kind: 'scoped',
      reason: `Permit2-route permit (${layers.join(', ')})`,
    })
    expect(built.settlementLayers).toEqual(layers)
  })

  test('can be held with restrictToActions beside other actions', () => {
    const raw: ScopedAction = { target: OTHER, selector: '0x12345678' }
    const definition = session([permit()], {
      restrictToActions: true,
      actions: [raw],
    })
    expect(codes(definition)).toEqual([])
    const built = toSession(definition, OPTIONS)
    expect(built.access).toEqual({
      kind: 'scoped',
      reason: 'restrictToActions; Permit2-route permit (ACROSS)',
    })
    expect(actionOn(built.actions, USDC, APPROVE)).toBeDefined()
    expect(actionOn(built.actions, OTHER, '0x12345678')).toBeDefined()
    expect(fallbackOf(definition)).toBeUndefined()
  })
})

describe('the fee actions a fallback permit scopes', () => {
  const fees = { appFeeCollector: COLLECTOR, paymaster: PAYMASTER, cap: 5n }
  const transfer = (to: Address, amount: bigint): Hex =>
    encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, amount],
    })

  test('is nothing without fees', () => {
    expect(
      permit2FallbackScope(new Map([[USDC, 5n]]), [], [], undefined),
    ).toEqual([])
  })

  test('is the capped transfer and callback, with no approve', () => {
    const actions = permit2FallbackScope(
      new Map([[USDC, undefined]]),
      [],
      [],
      fees,
    )
    expect(actions.map(({ target, selector }) => [target, selector])).toEqual([
      [USDC, TRANSFER],
      [PAYMASTER, CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR],
    ])
    expect(satisfiesRules(actions[0], transfer(COLLECTOR, 5n))).toBe(true)
    expect(satisfiesRules(actions[0], transfer(COLLECTOR, 6n))).toBe(false)
    expect(satisfiesRules(actions[0], transfer(OTHER, 1n))).toBe(false)
  })

  test('refuses a declared approve on the token', () => {
    expect(() =>
      permit2FallbackScope(
        new Map([[USDC, undefined]]),
        [],
        [{ target: USDC, selector: APPROVE }],
        fees,
      ),
    ).toThrow(expect.objectContaining({ code: 'PERMIT2_APPROVE_CONFLICT' }))
  })
})

describe.each([
  ['intentExecution', INTENT_EXECUTION_POLICY_ADDRESS],
  ['sudo', SUDO_POLICY_ADDRESS],
] as const)('a Permit2-route session with fallback: %s', (fallback, policy) => {
  const definition = (extra: Partial<CrossChainPermissionInput> = {}) =>
    session([oncePermit(extra)], { fallback })

  test('is open, with that fallback and no approve action of its own', () => {
    const built = toSession(definition(), OPTIONS)
    expect(built.access).toEqual({
      kind: 'open',
      reason: `fallback: ${fallback}`,
    })
    expect(
      fallbackOf(definition())?.actionPolicies.map((p) => p.policy),
    ).toEqual([policy])
    expect(actionOn(built.actions, USDC, APPROVE)).toBeUndefined()
    // Intents keep the routes the fallback can settle.
    expect(built.settlementLayers).toEqual(['ACROSS'])
    expect(built.hasExplicitPermissions).toBe(false)
  })

  test('admits a permit without `from`, or naming only SAME_CHAIN', () => {
    expect(codes(definition({ from: undefined }))).toEqual([])
    expect(codes(definition({ settlementLayers: ['SAME_CHAIN'] }))).toEqual([])
    const built = toSession(definition({ from: undefined }), OPTIONS)
    expect(actionOn(built.actions, USDC, APPROVE)).toBeUndefined()
  })

  test('carries the spending limit on the fallback only for intentExecution', () => {
    const capped = session(
      [oncePermit({ from: { chain: base, token: USDC, maxAmount: 5n } })],
      { fallback, ...otu },
    )
    expect(fallbackOf(capped)?.actionPolicies.map((p) => p.policy)).toEqual(
      fallback === 'sudo'
        ? [SUDO_POLICY_ADDRESS, ONE_TIME_USE]
        : [
            INTENT_EXECUTION_POLICY_ADDRESS,
            SPENDING_LIMITS_POLICY_ADDRESS,
            ONE_TIME_USE,
          ],
    )
  })

  // An exact (token, approve) action takes precedence over the wildcard, so it
  // would refuse every approve the wildcard admits (another layer's spender,
  // the paymaster).
  test.each<[string, Partial<CrossChainPermissionInput>, object]>([
    ['without allowFees', {}, {}],
    ['with allowFees', { allowFees: true }, {}],
    ['with allowFees and oneTimeUse', { allowFees: true }, otu],
  ])('holds no approve on its `from` token %s', (_, extra, more) => {
    const built = toSession(
      session([oncePermit(extra)], { fallback, ...more }),
      OPTIONS,
    )
    expect(
      built.actions.filter((a) => a.actionTargetSelector === APPROVE),
    ).toEqual([])
  })

  test.skipIf(fallback === 'sudo')(
    'keeps the fee transfer and paymaster callback with allowFees',
    () => {
      const fallbackBuilt = toSession(
        session([oncePermit({ allowFees: true })], { fallback, ...otu }),
        OPTIONS,
      )
      const scopedBuilt = toSession(
        session([oncePermit({ allowFees: true })], otu),
        OPTIONS,
      )
      // The same capped calls a scoped session gets.
      for (const [target, selector] of [
        [USDC, TRANSFER],
        [PAYMASTER, CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR],
      ] as const) {
        const kept = actionOn(fallbackBuilt.actions, target, selector)
        expect(kept).toBeDefined()
        expect(kept).toEqual(actionOn(scopedBuilt.actions, target, selector))
      }
      const plain = toSession(session([oncePermit()], { fallback }), OPTIONS)
      expect(actionOn(plain.actions, USDC, TRANSFER)).toBeUndefined()
      expect(
        actionOn(plain.actions, PAYMASTER, CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR),
      ).toBeUndefined()
    },
  )

  test.skipIf(fallback !== 'sudo')(
    'adds no rule for allowFees under sudo, which admits every fee call',
    () => {
      const built = (permitExtra: Partial<CrossChainPermissionInput>) =>
        toSession(
          session([oncePermit(permitExtra)], { fallback, ...otu }),
          OPTIONS,
        )
      expect(built({ allowFees: true }).actions).toEqual(built({}).actions)
      // Nothing to scope, so none of the fee checks apply.
      for (const [permitExtra, options] of [
        [{ allowFees: true, from: undefined }, OPTIONS],
        [{ allowFees: true }, {}],
        [{ allowFees: true, from: { chain: base, token: WETH } }, OPTIONS],
      ] as const) {
        expect(
          codes(session([oncePermit(permitExtra)], { fallback }), options),
        ).toEqual([])
      }
    },
  )

  test('leaves approve to the wildcard in the enabled session data', () => {
    for (const permitExtra of [{}, { allowFees: true }]) {
      const data = getSessionData(
        toSession(session([oncePermit(permitExtra)], { fallback }), OPTIONS),
      )
      const governing = data.actions.filter(
        (a) =>
          a.actionTargetSelector === APPROVE ||
          a.actionTarget === SMART_SESSIONS_FALLBACK_TARGET_FLAG,
      )
      expect(governing.map((a) => a.actionTarget)).toEqual([
        SMART_SESSIONS_FALLBACK_TARGET_FLAG,
      ])
      expect(governing[0].actionPolicies[0].policy).toBe(policy)
    }
  })

  test('still refuses a declared approve on its `from` token', () => {
    expect(
      codes(
        session([oncePermit()], {
          fallback,
          actions: [{ target: USDC, selector: APPROVE }],
        }),
      ),
    ).toContain('PERMIT2_APPROVE_CONFLICT')
  })
})

describe('fallback outside a Permit2-route session', () => {
  test.each<[string, Partial<SessionDefinition>]>([
    ['a plain session', { crossChainPermits: [] }],
    [
      'a settlement-scoped session',
      { crossChainPermits: [oncePermit({ settlementLayers: ['CCTP'] })] },
    ],
    [
      'restrictToActions',
      {
        restrictToActions: true,
        actions: [{ target: OTHER, selector: '0x12345678' }],
      },
    ],
    [
      'swap',
      {
        swap: {
          sell: { token: USDC, maxTotal: 1_000_000n },
          buy: { token: USDT },
          to: ACCOUNT,
        },
      } as Partial<SessionDefinition>,
    ],
  ])('is refused on %s', (_, extra) => {
    const definition = session([oncePermit()], { fallback: 'sudo', ...extra })
    expect(codes(definition)).toContain('FALLBACK_NOT_APPLICABLE')
  })
})

describe('a recipient pin beside a fallback', () => {
  const warningsOf = (definition: SessionDefinition) =>
    validateSessionDefinition(definition, OPTIONS).warnings
  const optOut = { allowRecipientNotAccount: true }
  const to = (recipient?: Address | 'any') => ({
    chain: arbitrum,
    token: USDC_ARB,
    ...(recipient === undefined ? {} : { recipient }),
  })

  describe.each(['intentExecution', 'sudo'] as const)('%s', (fallback) => {
    test.each<[string, Partial<CrossChainPermissionInput>]>([
      ['bridge-to-self by default', {}],
      ['a pinned recipient', { ...optOut, to: to(OTHER) }],
      ['the account pinned with the opt-out', { ...optOut, to: to(ACCOUNT) }],
      ['one pinned leg of several', { ...optOut, to: [to('any'), to(OTHER)] }],
    ])('warns on %s, refusing nothing', (_, extra) => {
      const definition = session([oncePermit(extra)], { fallback })
      expect(codes(definition)).toEqual([])
      expect(warningsOf(definition)).toEqual([
        {
          code: 'FALLBACK_RECIPIENT_PIN_ACROSS_ONLY',
          message:
            'crossChainPermits: with `fallback`, the recipient pin holds only for intents settled through ACROSS; use a settlement-scoped permit without `fallback` to pin it on IntentExecutor layers',
          permitIndex: 0,
        },
      ])
      expect(() => toSession(definition, OPTIONS)).not.toThrow()
    })

    test.each<[string, Partial<CrossChainPermissionInput>]>([
      ['no recipient with the opt-out', { ...optOut, to: to() }],
      ["recipient 'any'", { ...optOut, to: to('any') }],
    ])('does not warn on %s', (_, extra) => {
      expect(
        warningsOf(session([oncePermit(extra)], { fallback })),
      ).toBeUndefined()
    })
  })

  test('does not warn on a scoped session', () => {
    for (const extra of [{}, { ...optOut, to: to(OTHER) }]) {
      const definition = session([permit(extra)])
      expect(codes(definition)).toEqual([])
      expect(warningsOf(definition)).toBeUndefined()
    }
  })
})
