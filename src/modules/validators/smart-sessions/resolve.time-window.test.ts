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
import {
  INTENT_EXECUTION_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
} from './policies/addresses'
import { SMART_SESSIONS_FALLBACK_TARGET_FLAG, toSession } from './resolve'
import type { ResolvedPolicy, SessionDefinition } from './types'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address
const TARGET = '0x4444444444444444444444444444444444444444' as Address
const WETH = '0x4200000000000000000000000000000000000006' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const ARBITER = '0x00000000000000000000000000000000000000ab' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
// source: 2_000_000_000 s = 2033-05-18T03:33:20Z (date -u -r 2000000000)
const UNTIL = new Date(2_000_000_000_000)
const owners = { type: 'ecdsa' as const, accounts: [accountA] }

function eco(
  settlementLayers: ['ECO_IE'] | 'all',
  validUntil?: Date,
): SessionDefinition {
  return {
    chain: base,
    owners,
    account: ACCOUNT,
    oneTimeUse: { id: 7n },
    policyAddresses: { oneTimeUseId: ONE_TIME_USE },
    crossChainPermits: [
      {
        from: { chain: base, token: USDC, maxAmount: 100n },
        to: { chain: arbitrum, token: USDC_ARB, recipient: ACCOUNT },
        settlementLayers,
        maxFeeBps: 100,
        ...(validUntil === undefined ? {} : { validUntil }),
      },
    ],
  }
}

function fingerprint(definition: SessionDefinition) {
  const session = toSession(definition, { settlement: SETTLEMENT_CATALOG })
  return {
    permissionId: session.permissionId,
    data: keccak256(stringToHex(JSON.stringify(getSessionData(session)))),
  }
}

// Pinned sessions without an action window. The released shapes (sudo,
// permissions, raw actions, signing window) equal main; the oneTimeUse and
// CCTP rows are unreleased snapshots, and the Permit2 permit without
// maxAmount moved from main (below). The ECO_IE and 'all' rows with validUntil
// equal main; the ECO_IE row without one is a new snapshot.
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
  // Its fallback always carries the intent-execution policy (main:
  // 0x99711685…e5d2).
  // The Permit2 rows moved when Permit2-route sessions became scoped (RHI-8045);
  // the reusable one now sets preClaimOps: 'none', which its claim policy encodes.
  'Permit2 crossChainPermit, no maxAmount': {
    chain: base,
    owners,
    crossChainPermits: [
      {
        from: { chain: base, token: USDC },
        to: { chain: arbitrum, token: USDC_ARB },
        settlementLayers: ['ACROSS'],
        preClaimOps: 'none',
      },
    ],
  },
  'Permit2 crossChainPermit, oneTimeUse': {
    chain: base,
    owners,
    oneTimeUse: { id: 42n },
    policyAddresses: { oneTimeUseId: ONE_TIME_USE },
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
  'ECO_IE permit with oneTimeUse and validUntil': eco(['ECO_IE'], UNTIL),
  "'all' permit with oneTimeUse and validUntil": eco('all', UNTIL),
  // Unreleased: ECO_IE without validUntil carries no deadline pin.
  'ECO_IE permit with oneTimeUse, no validUntil': eco(['ECO_IE']),
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
  // The Permit2 rows moved when Permit2-route sessions became scoped (RHI-8045);
  // the reusable one now sets preClaimOps: 'none', which its claim policy encodes.
  'Permit2 crossChainPermit, no maxAmount': {
    permissionId:
      '0x68c574671b2a68321d441476cf4e4c1f59e1b0c8eb9f6b75ea956dad02678f80',
    data: '0xa8cee0069c3c09003a97948395e985cf4583c4524ebc048568157e439cb052f6',
  },
  'Permit2 crossChainPermit, oneTimeUse': {
    permissionId:
      '0x06c2faccc451915a0f80be98f62869f784577fdc36651be14341b9aebb85ea31',
    data: '0xe59abdf0d624b14a5687fb4501174e577be7f7c97cd7d0117ec14a7ba3a33464',
  },
  'oneTimeUse with permissions and claim policies': {
    permissionId:
      '0x9e3a4205e5610995830543d171b3b2b2b547b167d6ff28ecdc8df20fded09c3c',
    data: '0x6641737a429e015f167bbf72a784a43d211d40605e6f07d6100c6765ce79614a',
  },
  'oneTimeUse with raw actions': {
    permissionId:
      '0x09437cf6fc2f5f27f7bab5a8d1527850e600b054d344e3fbb525a33e1dcaf415',
    data: '0x6640ca3b8dde209b29db69d72d76bd7d51be6a450e3d13ebd2aeeaeb809719f8',
  },
  'signing window': {
    permissionId:
      '0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4',
    data: '0xe85a96179c54656557825227400e1a5099b36ccddb54271b34ef24cb08e0820a',
  },
  'CCTP permit with oneTimeUse and validUntil': {
    permissionId:
      '0xa8a9e8f395b07204d56599bc6f08ef1a9e915792314ec2d39d85a6f7a3bccf35',
    data: '0xdcc45c2fa680a975bde430fba67ffda2fe3d55b4ea86e4147e2262f2ce030cff',
  },
  'ECO_IE permit with oneTimeUse and validUntil': {
    permissionId:
      '0xff61c30f6b4794ec4840ad4bd44d24473fea1d14aa536c6e909b1e27133f4273',
    data: '0xeb6eb911771278c0a34d9179767931855b4830c7f8579c875aaa0207acb2b039',
  },
  "'all' permit with oneTimeUse and validUntil": {
    permissionId:
      '0xaaf9c2a56da66ebe7ccfcde1045788910b266d99fe0b56585e46cb7737bf5c95',
    data: '0xfd0a52ced0f5bdff5c29a94cc82b4e257913b64c2d8b5d9962e53f9b059ab478',
  },
  'ECO_IE permit with oneTimeUse, no validUntil': {
    permissionId:
      '0x87cd89541acd720fcf1ef0606465afd81d0796f79ef505ce47c293f5b2e14ec9',
    data: '0xa86846105fb19cbecc9bdc7c466bca318027bc28818aaac52906f01a676d5eff',
  },
}

describe('pins the permissionId and data of sessions without an action window', () => {
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
// Not USDC: its Permit2 approve would collide with `permission`'s approve.
const permit2Permit = (window: Window) => ({
  from: { chain: base, token: WETH, maxAmount: 100n },
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
      '0x11fad567145ba56b9c764007f66aa153899324b1c86613b72d633465d3834c79',
    data: '0x649bbc786e9db9e30358bd18604c844f0a48779cb078a6e202f61c6ea35e91ca',
  },
  'raw time-frame action, oneTimeUse': {
    permissionId:
      '0xe46b2f678467a3fb75c46fc0eb510695ab872dd3e8da1391c3cc202c261ad1f7',
    data: '0xbbb1fb8b30f1961d2003be2d5f67dbe76aba67855a6ecfcf1e12a3186d91c670',
  },
  // Moved again when Permit2-route sessions became scoped (RHI-8045).
  'Permit2 permit validUntil, oneTimeUse': {
    permissionId:
      '0xe4b27288976bd722ed22f896cf743efdd51f9642a3d28bfd49de0354bdb31564',
    data: '0x0e9e7c53b5df21133bf87ae326cdbaf7ca82aa7d70169953f4e0c001a6bc8edb',
  },
}

describe('a session whose window became the once-policy deadline', () => {
  test.each(Object.entries(WINDOWED))('%s', (name, definition) => {
    expect(fingerprint(definition)).toEqual(WINDOWED_PINS[name])
  })
})

// With `fallback: 'intentExecution'`, a Permit2-layer permit keeps its
// intent-execution fallback, whatever guardrails it sets; without one it has
// none.
describe('a Permit2-layer permit keeps the intent-execution fallback it asks for', () => {
  const fallbackPolicies = (definition: SessionDefinition) =>
    getSessionData(toSession(definition))
      .actions.filter((action) =>
        isAddressEqual(
          action.actionTarget,
          SMART_SESSIONS_FALLBACK_TARGET_FLAG,
        ),
      )
      .map((action) => action.actionPolicies.map((p) => p.policy))
  const permit = (window: Window) => ({
    from: { chain: base, token: USDC },
    to: { chain: arbitrum, token: USDC_ARB },
    settlementLayers: ['ACROSS' as const],
    ...window,
  })

  test('validUntil and oneTimeUse, no maxAmount', () => {
    const definition = {
      chain: base,
      owners,
      ...otu(),
      crossChainPermits: [permit({ validUntil: UNTIL })],
      fallback: 'intentExecution',
    } as SessionDefinition
    expect(fallbackPolicies(definition)).toEqual([
      [INTENT_EXECUTION_POLICY_ADDRESS, ONE_TIME_USE],
    ])
  })

  test('neither maxAmount nor validUntil, with oneTimeUse', () => {
    const definition = {
      chain: base,
      owners,
      ...otu(),
      crossChainPermits: [permit({})],
      fallback: 'intentExecution',
    } as SessionDefinition
    expect(fallbackPolicies(definition)).toEqual([
      [INTENT_EXECUTION_POLICY_ADDRESS, ONE_TIME_USE],
    ])
  })

  test('neither maxAmount nor validUntil, without oneTimeUse', () => {
    const definition = {
      chain: base,
      owners,
      crossChainPermits: [permit({})],
      fallback: 'intentExecution',
    } as SessionDefinition
    expect(fallbackPolicies(definition)).toEqual([
      [INTENT_EXECUTION_POLICY_ADDRESS],
    ])
  })

  test('without fallback, none', () => {
    const definition = {
      chain: base,
      owners,
      ...otu(),
      crossChainPermits: [permit({})],
    } as SessionDefinition
    expect(fallbackPolicies(definition)).toEqual([])
  })
})

test('a Permit2 claim admits no permit deadline past the once-policy deadline', () => {
  const signingPolicies = (oneTimeUseUntil: Date, permitUntil: Date) =>
    getSessionData(
      toSession({
        chain: base,
        owners,
        ...otu(oneTimeUseUntil),
        crossChainPermits: [permit2Permit({ validUntil: permitUntil })],
      } as SessionDefinition),
    ).erc7739Policies.erc1271Policies
  const earlier = at(T - 100n)
  expect(signingPolicies(earlier, UNTIL)).toEqual(
    signingPolicies(earlier, earlier),
  )
})
