import {
  type Address,
  decodeAbiParameters,
  erc20Abi,
  isAddressEqual,
  keccak256,
  stringToHex,
} from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../test/consts'
import { SETTLEMENT_CATALOG } from '../../../../test/utils/settlement-catalog'
import { getSessionData } from './digest'
import { TIME_FRAME_POLICY_ADDRESS } from './policies/addresses'
import { toSession } from './resolve'
import type { ResolvedPolicy, SessionDefinition } from './types'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address
const TARGET = '0x4444444444444444444444444444444444444444' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const ARBITER = '0x00000000000000000000000000000000000000ab' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
// source: 2_000_000_000 s = 2033-05-18T03:33:20Z (date -u -r 2000000000)
const UNTIL = new Date(2_000_000_000_000)
const owners = { type: 'ecdsa' as const, accounts: [accountA] }

function fingerprint(definition: SessionDefinition) {
  const session = toSession(definition, { settlement: SETTLEMENT_CATALOG })
  return {
    permissionId: session.permissionId,
    data: keccak256(stringToHex(JSON.stringify(getSessionData(session)))),
  }
}

// Sessions that set no time window on an action must not move.
const WINDOWLESS: Record<string, SessionDefinition> = {
  sudo: { chain: base, owners },
  'permissions, strict salt': {
    chain: base,
    owners,
    restrictToActions: true,
    saltMode: 'strict',
    permissions: [
      {
        abi: erc20Abi,
        address: USDC,
        functions: {
          transfer: {
            maxUses: 3n,
            params: { recipient: { condition: 'equal', value: ACCOUNT } },
            spendingLimit: { token: USDC, amount: 100n },
          },
        },
      },
    ],
  },
  'raw actions, strict salt': {
    chain: base,
    owners,
    restrictToActions: true,
    saltMode: 'strict',
    actions: [
      {
        target: TARGET,
        selector: '0x12345678',
        policies: [{ type: 'usage-limit', limit: 2n }],
      },
    ],
  },
  'Permit2 crossChainPermit': {
    chain: base,
    owners,
    crossChainPermits: [
      {
        from: { chain: base, token: USDC, maxAmount: 100n },
        to: { chain: arbitrum, token: USDC_ARB },
        settlementLayers: ['ACROSS'],
      },
    ],
  },
  'oneTimeUse with permissions and claim policies': {
    chain: base,
    owners,
    claimPolicies: [{ type: 'permit2', spenders: [ARBITER] }],
    oneTimeUse: { id: 42n, validUntil: UNTIL },
    policyAddresses: { oneTimeUseId: ONE_TIME_USE },
    permissions: [
      {
        abi: erc20Abi,
        address: USDC,
        functions: { approve: { maxUses: 1n } },
      },
    ],
  },
  'oneTimeUse with raw actions': {
    chain: base,
    owners,
    oneTimeUse: { id: 42n },
    policyAddresses: { oneTimeUseId: ONE_TIME_USE },
    actions: [{ target: TARGET, selector: '0x12345678' }],
  },
  'signing window': {
    chain: base,
    owners,
    signing: { mode: 'unrestricted', validUntil: UNTIL },
  },
  'CCTP permit with oneTimeUse and validUntil': {
    chain: base,
    owners,
    account: ACCOUNT,
    oneTimeUse: { id: 7n },
    policyAddresses: { oneTimeUseId: ONE_TIME_USE },
    crossChainPermits: [
      {
        from: { chain: base, token: USDC, maxAmount: 100n },
        to: { chain: arbitrum, token: USDC_ARB },
        settlementLayers: ['CCTP'],
        validUntil: UNTIL,
      },
    ],
  },
}

const PINS: Record<string, ReturnType<typeof fingerprint>> = {
  sudo: {
    permissionId:
      '0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4',
    data: '0x1b791b38b956d1668774edc6271033a527587365f14887f25d595f6f59f8ecd2',
  },
  'permissions, strict salt': {
    permissionId:
      '0x808c065224a8fb39921a8877d47144e2d016c553c252f52ec8eb888f3ad4b5e6',
    data: '0x4296fb45e854548ad4c61a8c54c2051a5299a2f94b0ad6dddbd1467ae9ae1d7c',
  },
  'raw actions, strict salt': {
    permissionId:
      '0x5e76b37831e3aba8f394e9fe12df02a8fdec55174e1b27c29adc810b8a5cc844',
    data: '0x4538d4956dfb324c2488d867a58f9388bd835707cd03ec2b271b5b59c68f1505',
  },
  'Permit2 crossChainPermit': {
    permissionId:
      '0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4',
    data: '0x77b9b5fedc7034a7a3697fc457eddba419fe6cfed294fb6dd4f21140c9791673',
  },
  'oneTimeUse with permissions and claim policies': {
    permissionId:
      '0x95b67478505169c7c2909d90a7c4593323e395cec895891644ecdc997ef47be3',
    data: '0x7a9eae27a5ca0b41756261702d0963e01d1e5bb82c5500e866dbe55efb77a995',
  },
  'oneTimeUse with raw actions': {
    permissionId:
      '0xa3f51489e58d860da4f7c9a62d6ad59399b71818f2024a63918449a3a43e2dbb',
    data: '0x9e1812c4bf425f47bafcc98313c9f3a62fd230e9b442ada45828beb3063b7a7c',
  },
  'signing window': {
    permissionId:
      '0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4',
    data: '0xe85a96179c54656557825227400e1a5099b36ccddb54271b34ef24cb08e0820a',
  },
  'CCTP permit with oneTimeUse and validUntil': {
    permissionId:
      '0xe67ea3240512c8162f9d8f2f5f8e56e5941c11b4737924687c7afc8c33fa7de9',
    data: '0x4a549b527124f0c37bec4952f2cd5f53f310c0413d0ad25b553347981e37100a',
  },
}

describe('a session with no action time window keeps its permissionId and data', () => {
  test.each(Object.entries(WINDOWLESS))('%s', (name, definition) => {
    expect(fingerprint(definition)).toEqual(PINS[name])
  })
})

const seconds = (date: Date) => BigInt(date.getTime() / 1000)
const at = (s: bigint) => new Date(Number(s) * 1000)
const T = seconds(UNTIL)

type Window = { readonly validUntil?: Date; readonly validAfter?: Date }

const permission = (window: Window) => ({
  abi: erc20Abi,
  address: USDC,
  functions: { approve: { maxUses: 1n, ...window } },
})
const rawAction = (window: Window) => ({
  target: TARGET,
  selector: '0x12345678' as const,
  policies: [
    { type: 'usage-limit' as const, limit: 2n },
    {
      type: 'time-frame' as const,
      validUntil: window.validUntil?.getTime() ?? 4_102_444_800_000,
      validAfter: window.validAfter?.getTime() ?? 0,
    },
  ],
})
const permit2Permit = (window: Window) => ({
  from: { chain: base, token: USDC, maxAmount: 100n },
  to: { chain: arbitrum, token: USDC_ARB },
  settlementLayers: ['ACROSS' as const],
  ...window,
})

/** Each place a session definition can set an action time window. */
const SOURCES = {
  permissions: {
    field: `permissions[${USDC}].approve`,
    define: (window: Window) => ({ permissions: [permission(window)] }),
  },
  actions: {
    field: `actions[${TARGET}:0x12345678]`,
    define: (window: Window) => ({ actions: [rawAction(window)] }),
  },
  crossChainPermits: {
    field: 'crossChainPermits[0]',
    define: (window: Window) => ({
      crossChainPermits: [permit2Permit(window)],
    }),
  },
} as const

const otu = (validUntil?: Date) => ({
  oneTimeUse: { id: 42n, ...(validUntil ? { validUntil } : {}) },
  policyAddresses: { oneTimeUseId: ONE_TIME_USE },
})

function everyPolicy(definition: SessionDefinition): ResolvedPolicy[] {
  const data = getSessionData(
    toSession(definition, { settlement: SETTLEMENT_CATALOG }),
  )
  return [
    ...data.actions.flatMap((action) => action.actionPolicies),
    ...data.erc7739Policies.erc1271Policies,
    ...data.claimPolicies,
  ]
}

/** The once-policy deadline every surface carries; throws if they disagree. */
function onceDeadline(definition: SessionDefinition): bigint {
  const policies = everyPolicy(definition)
  expect(
    policies.some((p) => isAddressEqual(p.policy, TIME_FRAME_POLICY_ADDRESS)),
  ).toBe(false)
  const once = new Set(
    policies
      .filter((p) => isAddressEqual(p.policy, ONE_TIME_USE))
      .map((p) => p.initData),
  )
  expect(once.size).toBe(1)
  return decodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [...once][0],
  )[1]
}

const REFUSAL =
  'a session time window requires oneTimeUse; set oneTimeUse with validUntil to bound the session (validAfter is not supported)'

describe('an action validUntil with oneTimeUse is the once-policy deadline', () => {
  test.each(Object.entries(SOURCES))('%s', (_, { define }) => {
    const definition = {
      chain: base,
      owners,
      ...otu(),
      ...define({ validUntil: UNTIL }),
    } as SessionDefinition
    expect(onceDeadline(definition)).toBe(T)
  })

  // Each source in turn holds the earliest deadline.
  const EARLIEST = ['oneTimeUse', ...Object.keys(SOURCES)] as const
  test.each(EARLIEST)('the earliest wins when %s is earliest', (earliest) => {
    const until = (name: string) => at(name === earliest ? T - 100n : T)
    const definition = {
      chain: base,
      owners,
      ...otu(until('oneTimeUse')),
      permissions: [permission({ validUntil: until('permissions') })],
      actions: [rawAction({ validUntil: until('actions') })],
      crossChainPermits: [
        permit2Permit({ validUntil: until('crossChainPermits') }),
      ],
    } as SessionDefinition
    expect(onceDeadline(definition)).toBe(T - 100n)
  })

  test('two permission functions fold to the earlier one', () => {
    const definition = {
      chain: base,
      owners,
      ...otu(),
      permissions: [
        {
          abi: erc20Abi,
          address: USDC,
          functions: {
            approve: { validUntil: UNTIL },
            transfer: { validUntil: at(T - 7n) },
          },
        },
      ],
    } as SessionDefinition
    expect(onceDeadline(definition)).toBe(T - 7n)
  })

  test('with an IntentExecutor-layer permit, the earlier of it and a permission', () => {
    const definition = {
      chain: base,
      owners,
      account: ACCOUNT,
      ...otu(),
      // Not USDC: CCTP's own approve on it would share the action id.
      permissions: [
        { ...permission({ validUntil: at(T - 9n) }), address: TARGET },
      ],
      crossChainPermits: [
        {
          from: { chain: base, token: USDC, maxAmount: 100n },
          to: { chain: arbitrum, token: USDC_ARB },
          settlementLayers: ['CCTP'],
          validUntil: UNTIL,
        },
      ],
    } as SessionDefinition
    expect(onceDeadline(definition)).toBe(T - 9n)
  })
})

describe('a session time window it cannot express is refused at resolve', () => {
  const cases = Object.entries(SOURCES).flatMap(([name, { field, define }]) => [
    [
      `${name}: validUntil without oneTimeUse`,
      field,
      define,
      false,
      { validUntil: UNTIL },
    ] as const,
    [
      `${name}: validAfter`,
      field,
      define,
      false,
      { validAfter: at(T - 100n) },
    ] as const,
    [
      `${name}: validAfter with oneTimeUse`,
      field,
      define,
      true,
      { validAfter: at(T - 100n) },
    ] as const,
    [
      `${name}: validAfter and validUntil with oneTimeUse`,
      field,
      define,
      true,
      { validAfter: at(T - 100n), validUntil: UNTIL },
    ] as const,
  ])

  test.each(cases)('%s', (_, field, define, withOnce, window) => {
    const definition = {
      chain: base,
      owners,
      ...(withOnce ? otu() : {}),
      ...define(window),
    } as SessionDefinition
    expect(() => toSession(definition)).toThrow(`${field}: ${REFUSAL}`)
  })

  const INVALID: Record<string, Date> = {
    'the epoch': new Date(0),
    'in the past': new Date(Date.now() - 86_400_000),
    'not a date': new Date(Number.NaN),
  }
  const pastCases = Object.entries(SOURCES).flatMap(
    ([name, { field, define }]) =>
      Object.entries(INVALID).map(
        ([label, validUntil]) =>
          [`${name}, ${label}`, field, define, validUntil] as const,
      ),
  )
  test.each(pastCases)(
    '%s: validUntil must be in the future',
    (_, field, define, validUntil) => {
      const definition = {
        chain: base,
        owners,
        ...otu(),
        ...define({ validUntil }),
      } as SessionDefinition
      expect(() => toSession(definition)).toThrow(
        `${field}: validUntil must be a valid Date in the future`,
      )
    },
  )

  const NOT_A_DATE: Record<string, unknown> = {
    null: null,
    'a string': '2033-05-18T03:33:20Z',
    'a number': UNTIL.getTime(),
  }
  const notADateCases = (['permissions', 'crossChainPermits'] as const).flatMap(
    (name) =>
      Object.entries(NOT_A_DATE).map(
        ([label, validUntil]) =>
          [`${name}, ${label}`, name, validUntil] as const,
      ),
  )
  test.each(notADateCases)(
    '%s: validUntil must be a Date',
    (_, name, validUntil) => {
      const { field, define } = SOURCES[name]
      const definition = {
        chain: base,
        owners,
        ...otu(),
        ...define({ validUntil } as unknown as Window),
      } as SessionDefinition
      expect(() => toSession(definition)).toThrow(
        `${field}: validUntil must be a valid Date in the future`,
      )
    },
  )

  test.each([null, '2033-05-18T03:33:20Z'])(
    'actions: a time-frame validUntil of %o must be a number',
    (validUntil) => {
      const definition = {
        chain: base,
        owners,
        ...otu(),
        actions: [
          {
            target: TARGET,
            selector: '0x12345678',
            policies: [{ type: 'time-frame', validUntil, validAfter: 0 }],
          },
        ],
      } as unknown as SessionDefinition
      expect(() => toSession(definition)).toThrow(
        `${SOURCES.actions.field}: validUntil must be a valid Date in the future`,
      )
    },
  )
})

// A raw action whose only policy was its window compiles as a permission whose
// only setting was its window: sudo, plus the once-policy.
test('a raw time-frame-only action is sudo, as a window-only permission is', () => {
  const policiesOf = (definition: SessionDefinition, target: Address) =>
    getSessionData(toSession(definition))
      .actions.find((action) => isAddressEqual(action.actionTarget, target))
      ?.actionPolicies.map((p) => p.policy)
  const raw = policiesOf(WINDOWED['raw time-frame action, oneTimeUse'], TARGET)
  const permission = policiesOf(
    WINDOWED['permissions validUntil, oneTimeUse'],
    USDC,
  )
  expect(raw).toHaveLength(2)
  expect(isAddressEqual(raw?.[1] as Address, ONE_TIME_USE)).toBe(true)
  expect(raw).toEqual(permission)
})

const WINDOWED: Record<string, SessionDefinition> = {
  'permissions validUntil, oneTimeUse': {
    chain: base,
    owners,
    ...otu(),
    permissions: [
      {
        abi: erc20Abi,
        address: USDC,
        functions: { approve: { validUntil: UNTIL } },
      },
    ],
  },
  'raw time-frame action, oneTimeUse': {
    chain: base,
    owners,
    ...otu(),
    actions: [
      {
        target: TARGET,
        selector: '0x12345678',
        policies: [
          { type: 'time-frame', validUntil: UNTIL.getTime(), validAfter: 0 },
        ],
      },
    ],
  },
  'Permit2 permit validUntil, oneTimeUse': {
    chain: base,
    owners,
    ...otu(),
    crossChainPermits: [
      {
        from: { chain: base, token: USDC, maxAmount: 100n },
        to: { chain: arbitrum, token: USDC_ARB },
        settlementLayers: ['ACROSS'],
        validUntil: UNTIL,
      },
    ],
  },
}

// These moved when their window became the once-policy deadline.
const WINDOWED_PINS: Record<string, ReturnType<typeof fingerprint>> = {
  'permissions validUntil, oneTimeUse': {
    permissionId:
      '0xb85339e133941810debd5d6a3921cbeff44eff3bd1a21d6293b52d120bc8b7e4',
    data: '0x4ec7ecc4edaea6451b9e99fd04ab5e448db07e610399445d04111d469f4509d1',
  },
  'raw time-frame action, oneTimeUse': {
    permissionId:
      '0xe46a3d35490ea0029b39e1913adb2a11d96b3221d17a032cb60020494dcf4da2',
    data: '0xb06ef3c963c4fa2cc0e62d616c379ff6778c7767b609b4c52db602ef4c922265',
  },
  'Permit2 permit validUntil, oneTimeUse': {
    permissionId:
      '0xfeeee96e7c4543fb3baf8c90f4c8456ad08e320dc14f37bc12f3a7552c7d424a',
    data: '0xd7d6ea301a89fd7dfedd33e238443a6c2f96f3cd3d9c6226209ce2fee6f37f86',
  },
}

describe('a session whose window became the once-policy deadline', () => {
  test.each(Object.entries(WINDOWED))('%s', (name, definition) => {
    expect(fingerprint(definition)).toEqual(WINDOWED_PINS[name])
  })
})
