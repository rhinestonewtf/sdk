import {
  type Abi,
  type Address,
  type Chain,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  isAddressEqual,
  maxUint256,
  toFunctionSelector,
  zeroHash,
} from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../test/consts'
import { satisfiesRules } from '../../../../test/utils/policy-rules'
import { SETTLEMENT_CATALOG } from '../../../../test/utils/settlement-catalog'
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
const WETH = '0x4200000000000000000000000000000000000006' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
const COLLECTOR = '0x5555555555555555555555555555555555555555' as Address
const PAYMASTER = '0x6666666666666666666666666666666666666666' as Address
const APPROVE = toFunctionSelector('approve(address,uint256)')
const TRANSFER = toFunctionSelector('transfer(address,uint256)')
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

const permit = (
  extra: Partial<CrossChainPermissionInput> = {},
): CrossChainPermissionInput => ({
  from: { chain: base, token: USDC },
  to: { chain: arbitrum, token: USDC_ARB },
  settlementLayers: ['ACROSS'],
  ...extra,
})

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

const resolved = (
  legs: CrossChainPermit['from'],
): readonly CrossChainPermit[] => [{ from: legs }]

describe('the Permit2 approve a Permit2-route permit scopes', () => {
  const only = (cap?: bigint) =>
    permit2RouteScope(new Map([[USDC, cap]]), [], [], undefined).actions

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

  describe('beside a declared approve on the token', () => {
    const declared = (spender?: object, extra: object = {}): Permission =>
      ({
        abi: erc20Abi as Abi,
        address: USDC,
        functions: {
          approve: {
            ...(spender ? { params: { spender } } : {}),
            ...extra,
          },
        },
      }) as Permission
    const merge = (
      permission: Permission,
      cap?: bigint,
      fees?: { appFeeCollector: Address; paymaster: Address },
    ) => permit2RouteScope(new Map([[USDC, cap]]), [permission], [], fees)

    test('adds Permit2 to a plain spender pin', () => {
      expect(merge(declared({ condition: 'equal', value: OTHER }))).toEqual({
        permissions: [
          declared({ anyOf: [OTHER, PERMIT2] }) as unknown as Permission,
        ],
        actions: [],
      })
      expect(merge(declared({ anyOf: [OTHER, PERMIT2] }))).toEqual({
        permissions: [declared({ anyOf: [OTHER, PERMIT2] })],
        actions: [],
      })
    })

    test.each([
      ['an approve open to every spender', declared(), undefined],
      ['a capped Permit2 approve', declared({ anyOf: [OTHER] }), 1n],
      [
        'a declared cap',
        declared(
          { anyOf: [OTHER] },
          { spendingLimit: { token: USDC, amount: 1n } },
        ),
        undefined,
      ],
      [
        'a usage limit on the spender',
        declared({ condition: 'equal', value: OTHER, usageLimit: 1n }),
        undefined,
      ],
      [
        'another rule on the spender',
        declared({ condition: 'notEqual', value: OTHER }),
        undefined,
      ],
    ])('refuses %s', (_, permission, cap) => {
      expect(() => merge(permission, cap)).toThrow(
        expect.objectContaining({ code: 'PERMIT2_APPROVE_CONFLICT' }),
      )
    })

    test('refuses a merge the fee calls would join', () => {
      expect(() =>
        merge(declared({ anyOf: [OTHER] }), undefined, {
          appFeeCollector: COLLECTOR,
          paymaster: PAYMASTER,
        }),
      ).toThrow(expect.objectContaining({ code: 'PERMIT2_APPROVE_CONFLICT' }))
    })

    test('refuses a raw approve action on the token', () => {
      const raw: ScopedAction = { target: USDC, selector: APPROVE }
      expect(() =>
        permit2RouteScope(new Map([[USDC, undefined]]), [], [raw], undefined),
      ).toThrow(expect.objectContaining({ code: 'PERMIT2_APPROVE_CONFLICT' }))
      // Even beside a declared approve it could otherwise merge into.
      expect(() =>
        permit2RouteScope(
          new Map([[USDC, undefined]]),
          [declared({ anyOf: [OTHER] })],
          [raw],
          undefined,
        ),
      ).toThrow(expect.objectContaining({ code: 'PERMIT2_APPROVE_CONFLICT' }))
    })
  })
})

describe('a Permit2-route session', () => {
  test('is scoped: its approve and claim, no fallback or wrap', () => {
    const definition = session([permit()])
    const built = toSession(definition, {
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
    const [scoped] = permit2RouteScope(
      new Map([[USDC, undefined]]),
      [],
      [],
      undefined,
    ).actions
    expect(built.actions[0].actionPolicies).toEqual(
      encodeActionPolicies(
        scoped.policies ?? [],
        'production',
        DEFAULT_POLICY_ADDRESSES,
      ),
    )
    // Its executions are checked against those actions once enabled.
    expect(built.hasExplicitPermissions).toBe(true)
    expect(built.settlementLayers).toEqual(['ACROSS'])
  })

  test('keeps its claim policy reachable through the signing gate', () => {
    const data = getSessionData(toSession(session([permit()]), OPTIONS))
    expect(data.erc7739Policies.allowedERC7739Content).toEqual([
      { appDomainSeparator: zeroHash, contentNames: [''] },
    ])
    expect(data.erc7739Policies.erc1271Policies).toHaveLength(1)
  })

  test('burns its one-time-use id like any session', () => {
    const built = toSession(
      session([permit({ from: { chain: base, token: USDC, maxAmount: 5n } })], {
        ...otu,
      }),
      OPTIONS,
    )
    expect(
      actionOn(built.actions, ONE_TIME_USE, CONSUME_SELECTOR),
    ).toBeDefined()
    expect(fallbackOf(session([permit()], { ...otu }))).toBeUndefined()
  })

  test('settles unsponsored intents with allowFees', () => {
    const built = toSession(session([permit({ allowFees: true })]), OPTIONS)
    expect(actionOn(built.actions, USDC, TRANSFER)).toBeDefined()
    expect(
      actionOn(built.actions, PAYMASTER, CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR),
    ).toBeDefined()
    expect(built.access?.kind).toBe('scoped')
    // Without it, no fee call is scoped.
    const plain = toSession(session([permit()]), OPTIONS)
    expect(actionOn(plain.actions, USDC, TRANSFER)).toBeUndefined()
  })

  test.each<[string, SessionDefinition, ResolveSessionOptions, string]>([
    [
      'allowFees without the catalog',
      session([permit({ allowFees: true })]),
      {},
      'ALLOW_FEES_CATALOG_MISSING',
    ],
    [
      'allowFees on a token that is not a served stablecoin',
      session([
        permit({ allowFees: true, from: { chain: base, token: WETH } }),
      ]),
      OPTIONS,
      'ALLOW_FEES_NON_STABLECOIN',
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
      'an ECO-only permit',
      session([permit({ settlementLayers: ['ECO'] })]),
      OPTIONS,
      'PERMIT2_ROUTE_NO_LIVE_LAYER',
    ],
    [
      'a SAME_CHAIN-only permit',
      session([permit({ settlementLayers: ['SAME_CHAIN', 'ECO'] })]),
      OPTIONS,
      'PERMIT2_ROUTE_NO_LIVE_LAYER',
    ],
  ])('refuses %s', (_, definition, options, code) => {
    expect(codes(definition, options)).toEqual([code])
    expect(() => toSession(definition, options)).toThrow(
      expect.objectContaining({ code }),
    )
  })

  test('admits ACROSS beside a retired arbiter, settling through ACROSS', () => {
    const built = toSession(
      session([permit({ settlementLayers: ['ACROSS', 'ECO'] })]),
      OPTIONS,
    )
    expect(built.access?.kind).toBe('scoped')
    expect(built.settlementLayers).toEqual(['ACROSS'])
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

describe.each([
  ['intentExecution', INTENT_EXECUTION_POLICY_ADDRESS],
  ['sudo', SUDO_POLICY_ADDRESS],
] as const)('a Permit2-route session with fallback: %s', (fallback, policy) => {
  const definition = (extra: Partial<CrossChainPermissionInput> = {}) =>
    session([permit(extra)], { fallback })

  test('is open, with that fallback beside its scoped approve', () => {
    const built = toSession(definition(), OPTIONS)
    expect(built.access).toEqual({
      kind: 'open',
      reason: `fallback: ${fallback}`,
    })
    expect(
      fallbackOf(definition())?.actionPolicies.map((p) => p.policy),
    ).toEqual([policy])
    expect(actionOn(built.actions, USDC, APPROVE)).toBeDefined()
    // Intents keep the routes the fallback can settle.
    expect(built.settlementLayers).toEqual(['ACROSS'])
    expect(built.hasExplicitPermissions).toBe(false)
  })

  test('admits a permit without `from` or naming only retired arbiters', () => {
    for (const extra of [
      { from: undefined },
      { settlementLayers: ['ECO' as const] },
    ]) {
      expect(codes(definition(extra))).toEqual([])
    }
    const built = toSession(definition({ from: undefined }), OPTIONS)
    expect(actionOn(built.actions, USDC, APPROVE)).toBeUndefined()
  })

  test('carries the spending limit on the fallback only for intentExecution', () => {
    const capped = session(
      [permit({ from: { chain: base, token: USDC, maxAmount: 5n } })],
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
})

describe('fallback outside a Permit2-route session', () => {
  test.each<[string, Partial<SessionDefinition>]>([
    ['a plain session', { crossChainPermits: [] }],
    [
      'a settlement-scoped session',
      { crossChainPermits: [permit({ settlementLayers: ['CCTP'] })] },
    ],
    [
      'restrictToActions',
      {
        restrictToActions: true,
        actions: [{ target: OTHER, selector: '0x12345678' }],
      },
    ],
  ])('is refused on %s', (_, extra) => {
    const definition = session([permit()], { fallback: 'sudo', ...extra })
    expect(codes(definition)).toContain('FALLBACK_WITHOUT_PERMIT2_PERMIT')
  })
})
