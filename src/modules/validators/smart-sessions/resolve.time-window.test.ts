import {
  type Address,
  decodeAbiParameters,
  erc20Abi,
  type Hex,
  isAddressEqual,
  keccak256,
  stringToHex,
} from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { accountA } from '../../../../test/consts'
import { SETTLEMENT_CATALOG } from '../../../../test/utils/settlement-catalog'
import {
  encodePermit2ClaimPolicyInitData,
  PERMIT2_CLAIM_POLICY_ADDRESS,
} from '../policies/claim/permit2'
import { getSessionData } from './digest'
import {
  INTENT_EXECUTION_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
} from './policies/addresses'
import { resolvePermit2ClaimPolicy } from './policies/claim'
import {
  DUMMY_PRECLAIMOP_TARGET,
  resolveSessionData,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  toSession,
  validateSessionDefinition,
} from './resolve'
import { PUBLISH_AND_FUND_SELECTOR } from './settlement/eco'
import type { SettlementCatalog } from './settlement/types'
import type { ResolvedAction, ResolvedPolicy, SessionDefinition } from './types'

// These tests assume the TimeFramePolicy is deployed on their chains.
vi.mock('./policies/addresses', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./policies/addresses')>()),
  timeFramePolicyDeployed: () => true,
}))

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address
const TARGET = '0x4444444444444444444444444444444444444444' as Address
const WETH = '0x4200000000000000000000000000000000000006' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const ARBITER = '0x00000000000000000000000000000000000000ab' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
const PREVIOUS_TIME_FRAME =
  '0x0000000000D30f611fA3bf652ac6879428586930' as Address
const APPROVE = '0x095ea7b3'
// source: 2_000_000_000 s = 2033-05-18T03:33:20Z (date -u -r 2000000000)
const UNTIL = new Date(2_000_000_000_000)
const AFTER = new Date(1_900_000_000_000)
// Year 2100: an open validUntil.
const FAR_FUTURE = 4_102_444_800n
const owners = { type: 'ecdsa' as const, accounts: [accountA] }
const seconds = (date: Date) => BigInt(date.getTime() / 1000)
const at = (s: bigint) => new Date(Number(s) * 1000)
const T = seconds(UNTIL)
const FEES = {
  appFeeCollector: '0x5555555555555555555555555555555555555555',
  paymaster: '0x6666666666666666666666666666666666666666',
} as const
const WITH_FEES: SettlementCatalog = {
  ...SETTLEMENT_CATALOG,
  [base.id]: { ...SETTLEMENT_CATALOG[base.id], fees: FEES },
}

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

// Sessions without a window, pinned to the values main gives them.
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
  'ECO_IE permit with oneTimeUse, no validUntil': {
    permissionId:
      '0x87cd89541acd720fcf1ef0606465afd81d0796f79ef505ce47c293f5b2e14ec9',
    data: '0xa86846105fb19cbecc9bdc7c466bca318027bc28818aaac52906f01a676d5eff',
  },
}

describe('a session without a window keeps its permissionId and data', () => {
  test.each(Object.entries(WINDOWLESS))('%s', (name, definition) => {
    expect(fingerprint(definition)).toEqual(PINS[name])
  })
})

const otu = (validUntil?: Date) => ({
  oneTimeUse: { id: 42n, ...(validUntil ? { validUntil } : {}) },
  policyAddresses: { oneTimeUseId: ONE_TIME_USE },
})

const WINDOWED: Record<string, SessionDefinition> = {
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
  'permissions validAfter and validUntil': {
    chain: base,
    owners,
    restrictToActions: true,
    permissions: [
      {
        abi: erc20Abi,
        address: USDC,
        functions: { approve: { validAfter: AFTER, validUntil: UNTIL } },
      },
    ],
  },
  'Permit2 permit validAfter and validUntil': {
    chain: base,
    owners,
    crossChainPermits: [
      {
        from: { chain: base, token: USDC },
        to: { chain: arbitrum, token: USDC_ARB },
        settlementLayers: ['ACROSS'],
        validAfter: AFTER,
        validUntil: UNTIL,
      },
    ],
  },
}

// Each window is a time-frame policy on the actions it applies to.
const WINDOWED_PINS: Record<string, ReturnType<typeof fingerprint>> = {
  'signing window': {
    permissionId:
      '0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4',
    data: '0x09074991264642c1a54c3e53041c05063ff45567f4f42f2a6616a118752df072',
  },
  'CCTP permit with oneTimeUse and validUntil': {
    permissionId:
      '0xa8fd44b972baa0daf579f7b946126138dd87af2358afdb18fd4f925b4b9dfc65',
    data: '0x7c7e8aeafe209c88aed3651e31b0d816e6e3a869b5f3545bc0a26b64c9fa569c',
  },
  'ECO_IE permit with oneTimeUse and validUntil': {
    permissionId:
      '0x6da26d359f93cb79744af5137741a1672947dc45e115718164e8536193a446d1',
    data: '0x2f443cb9ac767919f2818757a53e06fc8f8b1ded07fbe34360d85825718b7465',
  },
  "'all' permit with oneTimeUse and validUntil": {
    permissionId:
      '0xa7500b0535852597fff78a1558eec6bd78fe9c19a1b573b127794d43b1177b1d',
    data: '0xe26311b80e065e4e68a57b7bbf2ace4ff3771ff065db782eb79adbc11d97a574',
  },
  'permissions validUntil, oneTimeUse': {
    permissionId:
      '0x6bb4271e4536f51ef42c1a081a6212769c7ba9493f71f6a61ac2cd058ab7a3dd',
    data: '0xc7b2169e462503964316f4bfdba4728fe275159b4421a32b6c690ba88eee1abe',
  },
  'raw time-frame action, oneTimeUse': {
    permissionId:
      '0x032b3317b8ee92a629db27023e96961e00c1656bce57678b7b678a9a5b36d1c0',
    data: '0xf9cd5dbbeeb2afcfc5a04475b9096fa315f973f79979b36cb40541c043c920bd',
  },
  'Permit2 permit validUntil, oneTimeUse': {
    permissionId:
      '0x92105b215ecd41d1335b269a009baf7a5df7a05d0e2d57166eafa4b38952711b',
    data: '0xf8b1f72eda30b62868146d7471a58952e2acc80590182f58998a073e735a92ec',
  },
  'permissions validAfter and validUntil': {
    permissionId:
      '0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4',
    data: '0x9f2c4f49fb734a90f0e6f0ee23829f896f2a58b80cfb6196db012eb5adfbde95',
  },
  'Permit2 permit validAfter and validUntil': {
    permissionId:
      '0x9a78f5fbb8ef9f5849c11562dffe57b1716fa3a44afa540d0809296fb97667ca',
    data: '0x6ad12ca9a55b2dfbd78ec63a68bafc98c38da3c3622a786c97dd10a8af0990d2',
  },
}

describe('a session with a window', () => {
  test.each(Object.entries(WINDOWED))('%s', (name, definition) => {
    expect(fingerprint(definition)).toEqual(WINDOWED_PINS[name])
  })
})

/** encodePacked(uint48 validUntil, uint48 validAfter), in seconds. */
function timeFrame(initData: Hex) {
  return {
    validUntil: BigInt(`0x${initData.slice(2, 14)}`),
    validAfter: BigInt(`0x${initData.slice(14, 26)}`),
  }
}

const timeFramesOf = (
  policies: readonly ResolvedPolicy[],
  address: Address = TIME_FRAME_POLICY_ADDRESS,
) =>
  policies
    .filter((p) => isAddressEqual(p.policy, address))
    .map((p) => timeFrame(p.initData))

const window = (validUntil = FAR_FUTURE, validAfter = 0n) => [
  { validUntil, validAfter },
]

function actionOf(
  actions: readonly ResolvedAction[],
  target: Address,
  selector?: Hex,
): ResolvedAction {
  const action = actions.find(
    (a) =>
      isAddressEqual(a.actionTarget, target) &&
      (selector === undefined || a.actionTargetSelector === selector),
  )
  if (!action) throw new Error(`no action on ${target}`)
  return action
}

const resolve = (
  definition: SessionDefinition,
  options: Parameters<typeof resolveSessionData>[1] = {},
) =>
  resolveSessionData(definition, { settlement: SETTLEMENT_CATALOG, ...options })

describe("a permission function's window is a time frame on its action", () => {
  const session = (approve: object, transfer: object = {}) =>
    resolve({
      chain: base,
      owners,
      restrictToActions: true,
      permissions: [
        {
          abi: erc20Abi,
          address: USDC,
          functions: { approve, transfer: { maxUses: 1n, ...transfer } },
        },
      ],
    } as SessionDefinition).actions

  test.each([
    ['validUntil', { validUntil: UNTIL }, window(T)],
    ['validAfter', { validAfter: AFTER }, window(FAR_FUTURE, seconds(AFTER))],
    [
      'validAfter and validUntil',
      { validAfter: AFTER, validUntil: UNTIL },
      window(T, seconds(AFTER)),
    ],
  ])('%s, without oneTimeUse', (_, approve, expected) => {
    const actions = session(approve)
    expect(
      timeFramesOf(actionOf(actions, USDC, APPROVE).actionPolicies),
    ).toEqual(expected)
    // Only the function that sets it.
    expect(
      timeFramesOf(actionOf(actions, USDC, '0xa9059cbb').actionPolicies),
    ).toEqual([])
  })

  test('each function carries its own window', () => {
    const actions = session({ validUntil: UNTIL }, { validUntil: at(T - 7n) })
    expect(
      timeFramesOf(actionOf(actions, USDC, APPROVE).actionPolicies),
    ).toEqual(window(T))
    expect(
      timeFramesOf(actionOf(actions, USDC, '0xa9059cbb').actionPolicies),
    ).toEqual(window(T - 7n))
  })
})

test('a raw time-frame action policy is kept on its action', () => {
  const actions = resolve({
    chain: base,
    owners,
    restrictToActions: true,
    actions: [
      {
        target: TARGET,
        selector: '0x12345678',
        policies: [
          { type: 'usage-limit', limit: 2n },
          {
            type: 'time-frame',
            validUntil: UNTIL.getTime(),
            validAfter: AFTER.getTime(),
          },
        ],
      },
    ],
  }).actions
  expect(timeFramesOf(actionOf(actions, TARGET).actionPolicies)).toEqual(
    window(T, seconds(AFTER)),
  )
})

describe("a Permit2-route permit's window", () => {
  const permit2 = (
    permitWindow: { validUntil?: Date; validAfter?: Date },
    extra: Partial<SessionDefinition> = {},
    permit: object = {},
  ) =>
    ({
      chain: base,
      owners,
      crossChainPermits: [
        {
          from: { chain: base, token: USDC },
          to: { chain: arbitrum, token: USDC_ARB },
          settlementLayers: ['ACROSS'],
          ...permitWindow,
          ...permit,
        },
      ],
      ...extra,
    }) as SessionDefinition

  test('goes on its approve, its fee calls and the pre-claim action', () => {
    const { actions } = resolve(
      permit2({ validUntil: UNTIL }, {}, { allowFees: true }),
      { settlement: WITH_FEES },
    )
    expect(actions.map((a) => a.actionTarget.toLowerCase()).sort()).toEqual(
      [USDC, USDC, FEES.paymaster, DUMMY_PRECLAIMOP_TARGET]
        .map((a) => a.toLowerCase())
        .sort(),
    )
    for (const action of actions) {
      expect(timeFramesOf(action.actionPolicies)).toEqual(window(T))
    }
  })

  test('goes on the wrapped-native deposit', () => {
    const { actions } = resolve(
      permit2({ validUntil: UNTIL }, otu(), {
        from: { chain: base, token: WETH, maxAmount: 100n },
      }),
      { wrappedNativeToken: WETH },
    )
    expect(
      timeFramesOf(actionOf(actions, WETH, '0xd0e30db0').actionPolicies),
    ).toEqual(window(T))
  })

  test('with fallback, goes on the wildcard, the deposit and the pre-claim action', () => {
    const { actions } = resolve(
      permit2({ validAfter: AFTER }, { fallback: 'intentExecution' }),
      { wrappedNativeToken: WETH },
    )
    const wildcard = actionOf(actions, SMART_SESSIONS_FALLBACK_TARGET_FLAG)
    expect(wildcard.actionPolicies.map((p) => p.policy)).toEqual([
      INTENT_EXECUTION_POLICY_ADDRESS,
      TIME_FRAME_POLICY_ADDRESS,
    ])
    for (const target of [
      SMART_SESSIONS_FALLBACK_TARGET_FLAG,
      WETH,
      DUMMY_PRECLAIMOP_TARGET,
    ]) {
      expect(timeFramesOf(actionOf(actions, target).actionPolicies)).toEqual(
        window(FAR_FUTURE, seconds(AFTER)),
      )
    }
  })

  test('with fallback sudo, the wildcard keeps sudo and gets the window', () => {
    const { actions } = resolve(
      permit2({ validUntil: UNTIL }, { fallback: 'sudo' }),
    )
    expect(
      timeFramesOf(
        actionOf(actions, SMART_SESSIONS_FALLBACK_TARGET_FLAG).actionPolicies,
      ),
    ).toEqual(window(T))
  })

  // Permit2 accepts a deadline it has reached, so the claim stops 1s short.
  test.each([
    ['both', { validAfter: AFTER, validUntil: UNTIL }, seconds(AFTER), T - 1n],
    ['validUntil', { validUntil: UNTIL }, undefined, T - 1n],
    ['validAfter', { validAfter: AFTER }, seconds(AFTER), undefined],
  ])('bounds the claim deadline by %s', (_, permitWindow, min, max) => {
    const session = toSession(permit2(permitWindow))
    expect(session.claimPolicies[0].permitDeadline).toEqual({ min, max })
    expect(
      getSessionData(session).erc7739Policies.erc1271Policies.find((p) =>
        isAddressEqual(p.policy, PERMIT2_CLAIM_POLICY_ADDRESS),
      )?.initData,
    ).toBe(
      encodePermit2ClaimPolicyInitData(
        resolvePermit2ClaimPolicy(session.claimPolicies[0]),
      ),
    )
  })

  test('with only validUntil, leaves the 1271 list without a time frame', () => {
    const erc1271 = (definition: SessionDefinition) =>
      resolve(definition).erc7739Policies.erc1271Policies
    expect(timeFramesOf(erc1271(permit2({ validUntil: UNTIL })))).toEqual([])
    expect(
      erc1271(permit2({ validUntil: UNTIL })).map((p) => p.policy),
    ).toEqual(erc1271(permit2({ validUntil: at(T - 1n) })).map((p) => p.policy))
  })

  test.each([
    ['validAfter', { validAfter: AFTER }, window(FAR_FUTURE, seconds(AFTER))],
    [
      'validAfter and validUntil',
      { validAfter: AFTER, validUntil: UNTIL },
      window(T, seconds(AFTER)),
    ],
  ])('with %s, adds it to the 1271 list', (_, permitWindow, expected) => {
    expect(
      timeFramesOf(
        resolve(permit2(permitWindow)).erc7739Policies.erc1271Policies,
      ),
    ).toEqual(expected)
  })

  describe('beside a signing window', () => {
    const signing = (validAfter?: Date, validUntil?: Date) => ({
      signing: {
        mode: 'unrestricted' as const,
        ...(validAfter ? { validAfter } : {}),
        ...(validUntil ? { validUntil } : {}),
      },
    })

    test('is one 1271 time frame holding the time both allow', () => {
      const erc1271 = resolve(
        permit2(
          { validAfter: AFTER, validUntil: UNTIL },
          signing(at(seconds(AFTER) + 5n), at(T + 5n)),
        ),
      ).erc7739Policies.erc1271Policies
      expect(timeFramesOf(erc1271)).toEqual(window(T, seconds(AFTER) + 5n))
    })

    test('a signing window alone stays as it was', () => {
      expect(
        timeFramesOf(
          resolve(permit2({ validUntil: UNTIL }, signing(AFTER, at(T + 5n))))
            .erc7739Policies.erc1271Policies,
        ),
      ).toEqual(window(T + 5n, seconds(AFTER)))
    })

    test.each([
      ['ends before the permit window opens', T - 20n],
      ['ends as the permit window opens', T - 10n],
    ])('that %s is refused', (_, signingUntil) => {
      expect(() =>
        resolve(
          permit2(
            { validAfter: at(T - 10n), validUntil: UNTIL },
            signing(undefined, at(signingUntil)),
          ),
        ),
      ).toThrow(
        'signing: its window does not overlap the action or permit windows',
      )
    })
  })
})

describe("an IntentExecutor-layer permit's window", () => {
  const cctp = (
    permitWindow: { validUntil?: Date; validAfter?: Date },
    extra = {},
  ) =>
    ({
      chain: base,
      owners,
      account: ACCOUNT,
      crossChainPermits: [
        {
          from: { chain: base, token: USDC },
          to: { chain: arbitrum, token: USDC_ARB },
          settlementLayers: ['CCTP'],
          ...permitWindow,
        },
      ],
      ...extra,
    }) as SessionDefinition

  test('goes on each scoped layer action and the pre-claim action, without oneTimeUse', () => {
    const { actions } = resolve(cctp({ validAfter: AFTER, validUntil: UNTIL }))
    expect(actions).toHaveLength(3)
    actionOf(actions, DUMMY_PRECLAIMOP_TARGET)
    for (const action of actions) {
      expect(timeFramesOf(action.actionPolicies)).toEqual(
        window(T, seconds(AFTER)),
      )
    }
  })
})

/** The once-policy deadline every surface carries; throws if they disagree. */
function onceDeadline(definition: SessionDefinition): bigint {
  const data = resolve(definition)
  const once = new Set(
    [
      ...data.actions.flatMap((action) => action.actionPolicies),
      ...data.erc7739Policies.erc1271Policies,
    ]
      .filter((p) => isAddressEqual(p.policy, ONE_TIME_USE))
      .map((p) => p.initData),
  )
  expect(once.size).toBe(1)
  return decodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [...once][0],
  )[1]
}

describe('oneTimeUse.validUntil alone is the once-policy deadline', () => {
  const permission = {
    abi: erc20Abi,
    address: TARGET,
    functions: { approve: { validUntil: at(T - 9n) } },
  }
  const permit = (validUntil: Date) => ({
    from: { chain: base, token: USDC, maxAmount: 100n },
    to: { chain: arbitrum, token: USDC_ARB },
    settlementLayers: ['ACROSS' as const],
    validUntil,
  })

  test.each([
    ['without oneTimeUse.validUntil', undefined, 0n],
    ['with an earlier one', at(T - 100n), T - 100n],
    ['with a later one', at(T + 100n), T + 100n],
  ])('%s', (_, oneTimeUseUntil, expected) => {
    const definition = {
      chain: base,
      owners,
      ...otu(oneTimeUseUntil),
      permissions: [permission],
      actions: [
        {
          target: TARGET,
          selector: '0x12345678',
          policies: [
            {
              type: 'time-frame',
              validUntil: UNTIL.getTime() - 5000,
              validAfter: 0,
            },
          ],
        },
      ],
      crossChainPermits: [permit(UNTIL)],
    } as SessionDefinition
    expect(onceDeadline(definition)).toBe(expected)
  })

  test('the Permit2 claim admits no deadline past either one', () => {
    const claim = (oneTimeUseUntil: Date, permitUntil: Date) =>
      resolve({
        chain: base,
        owners,
        ...otu(oneTimeUseUntil),
        crossChainPermits: [permit(permitUntil)],
      } as SessionDefinition).erc7739Policies.erc1271Policies.find((p) =>
        isAddressEqual(p.policy, PERMIT2_CLAIM_POLICY_ADDRESS),
      )?.initData
    // The permit's validUntil caps the claim 1s short of it.
    expect(claim(at(T - 100n), UNTIL)).toBe(claim(UNTIL, at(T - 99n)))
    expect(claim(at(T - 100n), UNTIL)).not.toBe(claim(UNTIL, UNTIL))
  })

  // Signing builds the claim calldata from Session.claimPolicies.
  test.each([
    ['oneTimeUse', at(T - 100n), UNTIL, T - 100n],
    ['the permit', UNTIL, at(T - 100n), T - 101n],
  ])(
    'the session keeps the installed claim when %s ends first',
    (_, oneTimeUseUntil, permitUntil, max) => {
      const session = toSession({
        chain: base,
        owners,
        ...otu(oneTimeUseUntil),
        crossChainPermits: [permit(permitUntil)],
      } as SessionDefinition)
      const installed = getSessionData(
        session,
      ).erc7739Policies.erc1271Policies.filter((p) =>
        isAddressEqual(p.policy, PERMIT2_CLAIM_POLICY_ADDRESS),
      )
      expect(session.claimPolicies).toHaveLength(1)
      expect(installed).toEqual([
        {
          policy: PERMIT2_CLAIM_POLICY_ADDRESS,
          initData: encodePermit2ClaimPolicyInitData(
            resolvePermit2ClaimPolicy(session.claimPolicies[0]),
          ),
        },
      ])
      expect(session.claimPolicies[0].permitDeadline?.max).toBe(max)
    },
  )
})

describe('ECO_IE pins the earlier of oneTimeUse.validUntil and the permit validUntil', () => {
  const LATER = new Date(2_000_000_000_000)
  const EARLIER = new Date(1_990_000_000_000)
  const publish = (permitUntil?: Date, oneTimeUseUntil?: Date) => {
    const definition = eco(['ECO_IE'], permitUntil)
    definition.oneTimeUse = {
      id: 7n,
      ...(oneTimeUseUntil ? { validUntil: oneTimeUseUntil } : {}),
    }
    return actionOf(
      resolve(definition).actions,
      SETTLEMENT_CATALOG[base.id].eco!.portal,
      PUBLISH_AND_FUND_SELECTOR,
    ).actionPolicies.filter(
      (p) =>
        !isAddressEqual(p.policy, TIME_FRAME_POLICY_ADDRESS) &&
        !isAddressEqual(p.policy, ONE_TIME_USE),
    )
  }

  test.each([
    ['the permit', EARLIER, LATER],
    ['oneTimeUse', LATER, EARLIER],
  ])('when %s is earlier', (_, permitUntil, oneTimeUseUntil) => {
    expect(publish(permitUntil, oneTimeUseUntil)).toEqual(publish(EARLIER))
    expect(publish(permitUntil, oneTimeUseUntil)).not.toEqual(publish(LATER))
  })

  test('refuses an earliest deadline under 7 days ahead', () => {
    expect(() => publish(LATER, new Date(Date.now() + 86_400_000))).toThrow(
      'ECO_IE needs validUntil at least 7 days ahead',
    )
  })
})

test('policyAddresses.timeFrame rebuilds a session enabled with the previous address', () => {
  const definition: SessionDefinition = {
    ...WINDOWED['Permit2 permit validAfter and validUntil'],
    signing: { mode: 'unrestricted', validUntil: UNTIL },
  }
  const policies = (data: ReturnType<typeof resolve>) => [
    ...data.actions.flatMap((a) => a.actionPolicies),
    ...data.erc7739Policies.erc1271Policies,
  ]
  const byDefault = policies(resolve(definition))
  const previous = policies(
    resolve({
      ...definition,
      policyAddresses: { timeFrame: PREVIOUS_TIME_FRAME },
    }),
  )
  expect(timeFramesOf(byDefault).length).toBeGreaterThan(1)
  expect(timeFramesOf(previous, PREVIOUS_TIME_FRAME)).toEqual(
    timeFramesOf(byDefault),
  )
  expect(timeFramesOf(previous)).toEqual([])
})

describe('a window is refused at resolve when', () => {
  type Window = { readonly validUntil?: Date; readonly validAfter?: Date }
  const SOURCES = {
    permissions: {
      field: `permissions[${USDC}].approve`,
      define: (w: Window) => ({
        permissions: [
          { abi: erc20Abi, address: USDC, functions: { approve: w } },
        ],
      }),
    },
    actions: {
      field: `actions[${TARGET}:0x12345678]`,
      define: (w: Window) => ({
        actions: [
          {
            target: TARGET,
            selector: '0x12345678',
            policies: [
              {
                type: 'time-frame',
                validUntil: w.validUntil?.getTime() ?? 4_102_444_800_000,
                validAfter: w.validAfter?.getTime() ?? 0,
              },
            ],
          },
        ],
      }),
    },
    crossChainPermits: {
      field: 'crossChainPermits[0]',
      define: (w: Window) => ({
        crossChainPermits: [
          {
            from: { chain: base, token: USDC },
            to: { chain: arbitrum, token: USDC_ARB },
            settlementLayers: ['ACROSS'],
            ...w,
          },
        ],
      }),
    },
  } as const
  const session = (define: (w: Window) => object, w: Window) =>
    ({ chain: base, owners, ...define(w) }) as SessionDefinition

  test.each(Object.entries(SOURCES))(
    '%s: validAfter is not a valid Date',
    (_, { define }) => {
      expect(() =>
        toSession(
          session(define, {
            validAfter: new Date(Number.NaN),
            validUntil: UNTIL,
          }),
        ),
      ).toThrow('a validAfter that is not a Date within uint48 seconds')
    },
  )

  test.each(Object.entries(SOURCES))(
    '%s: validAfter reaches the open end',
    (_, { define }) => {
      expect(() =>
        toSession(session(define, { validAfter: new Date(4_102_444_800_000) })),
      ).toThrow('a validAfter not earlier than validUntil')
    },
  )

  test('actions: validAfter past uint48 seconds', () => {
    expect(() =>
      toSession({
        chain: base,
        owners,
        actions: [
          {
            target: TARGET,
            selector: '0x12345678',
            policies: [
              {
                type: 'time-frame',
                validUntil: UNTIL.getTime(),
                validAfter: 2 ** 48 * 1000,
              },
            ],
          },
        ],
      }),
    ).toThrow('a validAfter that is not a Date within uint48 seconds')
  })

  test.each(['permissions', 'actions'] as const)(
    '%s: a dry run reports it and goes on to the next refusal',
    (name) => {
      const definition = {
        ...session(SOURCES[name].define, {
          validAfter: UNTIL,
          validUntil: AFTER,
        }),
        crossChainPermits: [
          {
            from: { chain: base, token: WETH, maxAmount: 1n },
            to: { chain: arbitrum, token: USDC_ARB },
            settlementLayers: ['ACROSS'],
          },
        ],
      } as SessionDefinition
      expect(
        validateSessionDefinition(definition)
          .refusals.map(({ code }) => code)
          .sort(),
      ).toEqual([
        'PERMIT2_MAX_AMOUNT_REQUIRES_ONE_TIME_USE',
        'VALID_AFTER_EXCEEDS_VALID_UNTIL',
      ])
    },
  )

  test.each(Object.entries(SOURCES))(
    '%s: a dry run reports it once, with its code',
    (_, { define }) => {
      const { refusals } = validateSessionDefinition(
        session(define, { validAfter: UNTIL, validUntil: AFTER }),
      )
      expect(refusals.map(({ code }) => code)).toEqual([
        'VALID_AFTER_EXCEEDS_VALID_UNTIL',
      ])
    },
  )

  const INVALID: Record<string, Date> = {
    'the epoch': new Date(0),
    'in the past': new Date(Date.now() - 86_400_000),
    'not a date': new Date(Number.NaN),
  }
  test.each(
    Object.entries(SOURCES).flatMap(([name, { field, define }]) =>
      Object.entries(INVALID).map(
        ([label, validUntil]) =>
          [`${name}, ${label}`, field, define, validUntil] as const,
      ),
    ),
  )('%s: validUntil is not in the future', (_, field, define, validUntil) => {
    expect(() => toSession(session(define, { validUntil }))).toThrow(
      `${field}: a validUntil that is not a future Date`,
    )
  })

  test.each(
    (['permissions', 'crossChainPermits'] as const).flatMap((name) =>
      [null, '2033-05-18T03:33:20Z', UNTIL.getTime()].map(
        (validUntil) => [name, validUntil] as const,
      ),
    ),
  )('%s: validUntil %o is not a Date', (name, validUntil) => {
    const { field, define } = SOURCES[name]
    expect(() =>
      toSession(session(define, { validUntil } as unknown as Window)),
    ).toThrow(`${field}: a validUntil that is not a future Date`)
  })

  test.each(Object.entries(SOURCES))(
    '%s: validAfter is not earlier than validUntil',
    (_, { define }) => {
      for (const validAfter of [UNTIL, at(T + 1n)]) {
        expect(() =>
          toSession(session(define, { validAfter, validUntil: UNTIL })),
        ).toThrow('a validAfter not earlier than validUntil')
      }
    },
  )

  test.each(Object.entries(SOURCES))(
    '%s: never for want of oneTimeUse',
    (_, { define }) => {
      expect(() =>
        toSession(session(define, { validAfter: AFTER, validUntil: UNTIL })),
      ).not.toThrow()
    },
  )
})

test('a Permit2-route maxAmount still requires oneTimeUse, window or not', () => {
  expect(() =>
    toSession({
      chain: base,
      owners,
      crossChainPermits: [
        {
          from: { chain: base, token: USDC, maxAmount: 100n },
          to: { chain: arbitrum, token: USDC_ARB },
          settlementLayers: ['ACROSS'],
          validUntil: UNTIL,
        },
      ],
    }),
  ).toThrow(
    "a Permit2-route permit's maxAmount is enforced only with oneTimeUse",
  )
})

test('a window that ends within the second it opens is refused', () => {
  expect(() =>
    toSession({
      chain: base,
      owners,
      actions: [
        {
          target: TARGET,
          selector: '0x12345678',
          policies: [
            {
              type: 'time-frame',
              validUntil: UNTIL.getTime(),
              validAfter: UNTIL.getTime() - 500,
            },
          ],
        },
      ],
    }),
  ).toThrow('a validAfter not earlier than validUntil')
})

test('a validAfter between seconds opens at the next one', () => {
  const after = new Date(AFTER.getTime() + 1)
  const { actions } = resolve({
    chain: base,
    owners,
    restrictToActions: true,
    permissions: [
      {
        abi: erc20Abi,
        address: USDC,
        functions: { approve: { validAfter: after } },
      },
    ],
  })
  expect(timeFramesOf(actions[0].actionPolicies)).toEqual(
    window(FAR_FUTURE, seconds(AFTER) + 1n),
  )
  const session = toSession({
    chain: base,
    owners,
    crossChainPermits: [
      {
        from: { chain: base, token: USDC },
        to: { chain: arbitrum, token: USDC_ARB },
        settlementLayers: ['ACROSS'],
        validAfter: after,
      },
    ],
  })
  expect(session.claimPolicies[0].permitDeadline?.min).toBe(seconds(AFTER) + 1n)
  const signing = resolve({
    chain: base,
    owners,
    signing: { mode: 'unrestricted', validAfter: after },
  }).erc7739Policies.erc1271Policies
  expect(timeFramesOf(signing)).toEqual(window(FAR_FUTURE, seconds(AFTER) + 1n))
})

describe('an open signing surface is bounded by the action windows', () => {
  const definition = (extra: Partial<SessionDefinition> = {}) =>
    ({
      chain: base,
      owners,
      permissions: [
        {
          abi: erc20Abi,
          address: USDC,
          functions: { approve: { validUntil: UNTIL } },
        },
      ],
      actions: [
        {
          target: TARGET,
          selector: '0x12345678',
          policies: [
            {
              type: 'time-frame',
              validUntil: UNTIL.getTime() + 50_000,
              validAfter: AFTER.getTime(),
            },
          ],
        },
      ],
      ...extra,
    }) as SessionDefinition
  const erc1271 = (d: SessionDefinition) =>
    resolve(d).erc7739Policies.erc1271Policies

  test('by their union, with signing left unrestricted', () => {
    expect(erc1271(definition())).toHaveLength(1)
    expect(timeFramesOf(erc1271(definition()))).toEqual(window(T + 50n, 0n))
  })

  test('an open end stays open', () => {
    const d = definition({ actions: [] })
    d.permissions = [
      {
        abi: erc20Abi,
        address: USDC,
        functions: { approve: { validAfter: AFTER } },
      },
    ]
    expect(timeFramesOf(erc1271(d))).toEqual(window(FAR_FUTURE, seconds(AFTER)))
  })

  test('narrowed by a signing window', () => {
    expect(
      timeFramesOf(
        erc1271(
          definition({
            signing: {
              mode: 'unrestricted',
              validAfter: at(seconds(AFTER) + 5n),
              validUntil: at(T + 100n),
            },
          }),
        ),
      ),
    ).toEqual(window(T + 50n, seconds(AFTER) + 5n))
  })

  test('a signing window that misses them is refused', () => {
    expect(() =>
      resolve(
        definition({
          signing: { mode: 'unrestricted', validAfter: at(T + 60n) },
        }),
      ),
    ).toThrow(
      'signing: its window does not overlap the action or permit windows',
    )
  })

  test.each([
    ['signing disabled', { signing: { mode: 'disabled' } }],
    [
      'a restricted session, whose signing defaults to disabled',
      { restrictToActions: true },
    ],
    [
      'claim policies, which bound the ERC-1271 list',
      { claimPolicies: [{ type: 'permit2', spenders: [ARBITER] }] },
    ],
  ] as const)('not with %s', (_, extra) => {
    expect(
      timeFramesOf(erc1271(definition(extra as Partial<SessionDefinition>))),
    ).toEqual([])
  })

  test('a session without action windows keeps its signing list', () => {
    expect(erc1271({ chain: base, owners })).toEqual(
      erc1271({
        chain: base,
        owners,
        actions: [{ target: TARGET, selector: '0x12345678' }],
      }),
    )
  })
})
