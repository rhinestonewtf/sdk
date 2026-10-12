import {
  type Address,
  type Chain,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  isAddressEqual,
  toFunctionSelector,
  zeroHash,
} from 'viem'
import { arbitrum, avalanche, base, optimism } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { accountA } from '../../../../test/consts'
import { admits, install } from '../../../../test/utils/installed-policies'
import { sessionFingerprint } from '../../../../test/utils/session-fingerprint'
import { SETTLEMENT_CATALOG } from '../../../../test/utils/settlement-catalog'
import { PERMIT2_CLAIM_POLICY_ADDRESS } from '../policies/claim/permit2'
import { getSessionDetails, hasLifetimeBudget } from './authorization'
import {
  DEFAULT_POLICY_ADDRESSES,
  PERMIT2_SENDER_POLICY_ADDRESS,
  UNIVERSAL_ACTION_POLICY_COPIES,
} from './policies/addresses'
import {
  type ResolveSessionOptions,
  resolveSessionData,
  toSession,
  validateSessionDefinition,
} from './resolve'
import { PERMIT2 } from './swap/stable-floor'
import type {
  CrossChainPermissionInput,
  Session,
  SessionDefinition,
} from './types'

// These tests assume the TimeFramePolicy is deployed on their chains.
vi.mock('./policies/addresses', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./policies/addresses')>()),
  timeFramePolicyDeployed: () => true,
}))

const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
const PAYMASTER = '0x6666666666666666666666666666666666666666' as Address
const APPROVE = toFunctionSelector('approve(address,uint256)')
const BASE = SETTLEMENT_CATALOG[base.id]
const USDC = BASE.cctp!.usdc
const USDC_ARB = SETTLEMENT_CATALOG[arbitrum.id].cctp!.usdc
const USDC_AVAX = SETTLEMENT_CATALOG[avalanche.id].cctp!.usdc
const USDC_OP = SETTLEMENT_CATALOG[optimism.id].cctp!.usdc
const MESSENGER = BASE.cctp!.tokenMessenger
const PORTAL = BASE.eco!.portal
const WETH = '0x4200000000000000000000000000000000000006' as Address
const WETH_ARB = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1' as Address
const VALID_UNTIL = new Date(2_000_000_000_000)
const OPTIONS: ResolveSessionOptions = { settlement: SETTLEMENT_CATALOG }
const FEE_OPTIONS: ResolveSessionOptions = {
  settlement: {
    ...SETTLEMENT_CATALOG,
    [base.id]: {
      ...BASE,
      fees: {
        appFeeCollector: '0x5555555555555555555555555555555555555555',
        paymaster: PAYMASTER,
      },
    },
  },
}
const KINDS = {
  universalAction: [
    DEFAULT_POLICY_ADDRESSES.universalAction,
    ...UNIVERSAL_ACTION_POLICY_COPIES,
  ],
  argPolicy: DEFAULT_POLICY_ADDRESSES.argPolicy,
}

const once = {
  oneTimeUse: { id: 7n },
  policyAddresses: { oneTimeUseId: ONE_TIME_USE },
} as const satisfies Partial<SessionDefinition>

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
        from: { chain, token: chain.id === avalanche.id ? USDC_AVAX : USDC },
        to: { chain: arbitrum, token: USDC_ARB },
        ...permit,
      },
    ],
    ...extra,
  } as SessionDefinition
}

const capped = (
  permit: Partial<CrossChainPermissionInput>,
): Partial<CrossChainPermissionInput> => ({
  from: { chain: base, token: USDC, maxAmount: 100n },
  ...permit,
})

const eco = {
  maxFeeBps: 50,
  validUntil: VALID_UNTIL,
} as const satisfies Partial<CrossChainPermissionInput>

const codes = (def: SessionDefinition, options = OPTIONS) =>
  validateSessionDefinition(def, options).refusals.map(({ code }) => code)

const approve = (spender: Address, amount: bigint) =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  })

/** The `from` token's approve, installed once: every intent then draws on its counter. */
function installedApprove(
  def: SessionDefinition,
  token: Address = USDC,
  options = OPTIONS,
) {
  const approves = resolveSessionData(def, options).actions.filter(
    (a) =>
      isAddressEqual(a.actionTarget, token) &&
      a.actionTargetSelector === APPROVE,
  )
  expect(approves).toHaveLength(1)
  return install(approves[0].actionPolicies, KINDS)
}

describe('maxAmount on a reusable session', () => {
  test.each<[string, SessionDefinition, readonly string[], readonly Address[]]>(
    [
      [
        "['ACROSS'] alone",
        definition(capped({ settlementLayers: ['ACROSS'] })),
        ['ACROSS'],
        [PERMIT2],
      ],
      [
        "['CCTP']",
        definition(capped({ settlementLayers: ['CCTP'] })),
        ['CCTP'],
        [MESSENGER],
      ],
      [
        "['ECO_IE']",
        definition(capped({ settlementLayers: ['ECO_IE'], ...eco })),
        ['ECO_IE'],
        [PORTAL],
      ],
      [
        "['CCTP', 'ECO_IE']",
        definition(capped({ settlementLayers: ['CCTP', 'ECO_IE'], ...eco })),
        ['CCTP', 'ECO_IE'],
        [MESSENGER, PORTAL],
      ],
      [
        "['ACROSS', 'CCTP']",
        definition(capped({ settlementLayers: ['ACROSS', 'CCTP'] })),
        ['ACROSS', 'CCTP'],
        [MESSENGER, PERMIT2],
      ],
      [
        "'all'",
        definition(capped({ settlementLayers: 'all' })),
        ['ACROSS', 'CCTP'],
        [MESSENGER, PERMIT2],
      ],
      [
        'omitted layers',
        definition(capped({})),
        ['ACROSS', 'CCTP'],
        [MESSENGER, PERMIT2],
      ],
    ],
  )('builds %s', (_, def, layers, spenders) => {
    expect(codes(def)).toEqual([])
    const session = toSession(def, OPTIONS)
    expect(session.settlementLayers).toEqual(layers)
    expect(session.oneTimeUse).toBeUndefined()
    // Every route draws on the one counter: a full budget to any spender ends it.
    for (const spender of spenders) {
      const installed = installedApprove(def)
      expect(admits(installed, approve(spender, 101n))).toBe(false)
      expect(admits(installed, approve(spender, 100n))).toBe(true)
      for (const other of spenders) {
        expect(admits(installed, approve(other, 1n))).toBe(false)
      }
    }
  })

  test("binds the ACROSS claim with Permit2SenderPolicy, as an uncapped session's", () => {
    const def = definition(capped({ settlementLayers: ['ACROSS'] }))
    expect(
      resolveSessionData(def, OPTIONS).erc7739Policies.erc1271Policies.map(
        ({ policy }) => policy,
      ),
    ).toEqual([PERMIT2_CLAIM_POLICY_ADDRESS, PERMIT2_SENDER_POLICY_ADDRESS])
    // The intent pin stays the whole cap; the chain refuses what is spent.
    expect(toSession(def, OPTIONS).permit2Sources).toEqual([
      { chain: base, token: USDC, maxAmount: 100n },
    ])
  })

  test('adds no once-policy and no burn', () => {
    const data = resolveSessionData(
      definition(capped({ settlementLayers: ['ACROSS', 'CCTP'] })),
      OPTIONS,
    )
    for (const action of data.actions) {
      expect(
        action.actionPolicies.some(({ policy }) =>
          isAddressEqual(policy, ONE_TIME_USE),
        ),
      ).toBe(false)
    }
  })

  test("drops the layers that need oneTimeUse from 'all', with the reason", () => {
    const { settlementCoverage } = toSession(
      definition(capped({ settlementLayers: 'all' })),
      OPTIONS,
    )
    expect(settlementCoverage?.dropped).toEqual(
      expect.arrayContaining([
        {
          layer: 'LZ',
          reason: 'an LZ permit requires oneTimeUse',
        },
      ]),
    )
  })

  test.each<[string, SessionDefinition, string]>([
    [
      'OFT',
      definition(
        {
          from: {
            chain: arbitrum,
            token: SETTLEMENT_CATALOG[arbitrum.id].oft!.token,
            maxAmount: 100n,
          },
          to: {
            chain: optimism,
            token: SETTLEMENT_CATALOG[optimism.id].oft!.token,
          },
          settlementLayers: ['OFT'],
        },
        {},
        arbitrum,
      ),
      'LAYER_REQUIRES_ONE_TIME_USE',
    ],
    [
      'LZ',
      definition(capped({ settlementLayers: ['LZ'] })),
      'LAYER_REQUIRES_ONE_TIME_USE',
    ],
    [
      '`fallback`',
      definition(capped({ settlementLayers: ['ACROSS'] }), {
        fallback: 'intentExecution',
      }),
      'PERMIT2_MAX_AMOUNT_REQUIRES_ONE_TIME_USE',
    ],
    [
      "`fallback: 'sudo'`",
      definition(capped({ settlementLayers: ['ACROSS'] }), {
        fallback: 'sudo',
      }),
      'PERMIT2_MAX_AMOUNT_REQUIRES_ONE_TIME_USE',
    ],
    [
      "preClaimOps: 'none', whose claims spend an allowance it does not count",
      definition(
        {
          from: { chain: avalanche, token: USDC_AVAX, maxAmount: 100n },
          settlementLayers: ['ACROSS'],
          preClaimOps: 'none',
        },
        {},
        avalanche,
      ),
      'PRE_CLAIM_OPS_NOT_APPLICABLE',
    ],
    [
      "preClaimOps: 'none' beside a layer",
      definition(
        capped({ settlementLayers: ['ACROSS', 'CCTP'], preClaimOps: 'none' }),
      ),
      'PRE_CLAIM_OPS_NOT_APPLICABLE',
    ],
  ])('still refuses %s', (_, def, code) => {
    expect(codes(def)).toEqual([code])
  })
})

describe('the lifetime budget across intents', () => {
  test('holds one total across intents and routes', () => {
    const installed = installedApprove(
      definition(capped({ settlementLayers: ['ACROSS', 'CCTP'] })),
    )
    // Intent 1 settles through ACROSS, intent 2 through CCTP.
    expect(admits(installed, approve(PERMIT2, 60n))).toBe(true)
    expect(admits(installed, approve(MESSENGER, 41n))).toBe(false)
    expect(admits(installed, approve(MESSENGER, 40n))).toBe(true)
    // Intent 3 finds nothing left on either route.
    expect(admits(installed, approve(PERMIT2, 1n))).toBe(false)
    expect(admits(installed, approve(MESSENGER, 1n))).toBe(false)
    // Resetting an allowance stays open, as USDT-like tokens need it.
    expect(admits(installed, approve(PERMIT2, 0n))).toBe(true)
  })

  test("holds it across every layer 'all' keeps and ECO_IE", () => {
    const installed = installedApprove(
      definition(capped({ settlementLayers: ['CCTP', 'ECO_IE'], ...eco })),
    )
    expect(admits(installed, approve(PORTAL, 70n))).toBe(true)
    expect(admits(installed, approve(MESSENGER, 31n))).toBe(false)
    expect(admits(installed, approve(MESSENGER, 30n))).toBe(true)
    expect(admits(installed, approve(PORTAL, 1n))).toBe(false)
  })

  test('counts each approve, so re-approving a spender spends the budget again', () => {
    const installed = installedApprove(
      definition(capped({ settlementLayers: ['ACROSS'] })),
    )
    expect(admits(installed, approve(PERMIT2, 60n))).toBe(true)
    expect(admits(installed, approve(PERMIT2, 60n))).toBe(false)
    expect(admits(installed, approve(PERMIT2, 40n))).toBe(true)
  })

  test('many small approves end the budget as one large one does', () => {
    const installed = installedApprove(
      definition(capped({ settlementLayers: ['ACROSS', 'CCTP'] })),
    )
    for (let intent = 0; intent < 100; intent++) {
      const spender = intent % 2 ? MESSENGER : PERMIT2
      expect(admits(installed, approve(spender, 1n))).toBe(true)
    }
    expect(admits(installed, approve(PERMIT2, 1n))).toBe(false)
    expect(admits(installed, approve(MESSENGER, 1n))).toBe(false)
  })

  test('keeps the fee budget apart from maxAmount with allowFees', () => {
    const installed = installedApprove(
      definition(
        capped({ settlementLayers: ['ACROSS', 'CCTP'], allowFees: true }),
      ),
      USDC,
      FEE_OPTIONS,
    )
    expect(admits(installed, approve(PAYMASTER, 1_000_000n))).toBe(true)
    expect(admits(installed, approve(PERMIT2, 60n))).toBe(true)
    // A paymaster approve neither spends nor refunds the layers' budget.
    expect(admits(installed, approve(PAYMASTER, 1_000_000n))).toBe(true)
    expect(admits(installed, approve(MESSENGER, 41n))).toBe(false)
    expect(admits(installed, approve(MESSENGER, 40n))).toBe(true)
  })

  test('caps each `from` token on the chain with its own lifetime budget', () => {
    const def = definition({
      from: [
        { chain: base, token: USDC, maxAmount: 100n },
        { chain: base, token: OTHER },
      ],
      settlementLayers: ['ACROSS'],
    })
    expect(codes(def)).toEqual([])
    const usdc = installedApprove(def, USDC)
    expect(admits(usdc, approve(PERMIT2, 100n))).toBe(true)
    expect(admits(usdc, approve(PERMIT2, 1n))).toBe(false)
    // A leg without its own maxAmount is not capped, and the session says so.
    const other = installedApprove(def, OTHER)
    expect(admits(other, approve(PERMIT2, 10n ** 30n))).toBe(true)
    expect(validateSessionDefinition(def, OPTIONS).warnings).toEqual([
      expect.objectContaining({
        code: 'UNCAPPED_ACROSS_ROUTE',
        permitIndex: 0,
      }),
    ])
  })

  test('a per-call bound alone would admit the cap again on every intent', () => {
    // Each layer call keeps its own counter at the cap, so only the shared
    // approve bounds the routes together.
    const data = resolveSessionData(
      definition(capped({ settlementLayers: ['CCTP'] })),
      OPTIONS,
    )
    const call = data.actions.find((a) =>
      isAddressEqual(a.actionTarget, MESSENGER),
    )
    expect(call).toBeDefined()
    const approveAction = installedApprove(
      definition(capped({ settlementLayers: ['CCTP'] })),
    )
    const limited = [...approveAction.configs.values()].flatMap((config) =>
      config.kind === 'other' ? [] : config.rules.filter((r) => r.isLimited),
    )
    expect(limited.map(({ limit }) => limit)).toEqual([100n])
  })
})

describe('the permissionId of a reusable capped session', () => {
  // A shared permissionId would share the counter, or skip installing the cap
  // when the id is already enabled.
  test.each<
    [string, Partial<CrossChainPermissionInput>, Partial<SessionDefinition>]
  >([
    ["['ACROSS']", { settlementLayers: ['ACROSS'] }, {}],
    [
      "['ACROSS'], saltMode 'none'",
      { settlementLayers: ['ACROSS'] },
      { saltMode: 'none' },
    ],
    [
      "['ACROSS'], saltMode 'v1'",
      { settlementLayers: ['ACROSS'] },
      { saltMode: 'v1' },
    ],
    ["['ACROSS', 'CCTP']", { settlementLayers: ['ACROSS', 'CCTP'] }, {}],
    ["['CCTP']", { settlementLayers: ['CCTP'] }, {}],
  ])('is salted over its cap for %s', (_, permit, extra) => {
    const at = (maxAmount?: bigint) =>
      toSession(
        definition(
          {
            ...permit,
            from: { chain: base, token: USDC, ...(maxAmount && { maxAmount }) },
          },
          extra,
        ),
        OPTIONS,
      )
    const sessions = [at(100n), at(200n), at()]
    expect(sessions[0].salt).not.toBe(zeroHash)
    expect(new Set(sessions.map((s) => s.permissionId)).size).toBe(3)
  })
})

describe('the uncapped ACROSS route warning', () => {
  const warnings = (def: SessionDefinition) =>
    validateSessionDefinition(def, OPTIONS).warnings ?? []

  test.each<[string, SessionDefinition]>([
    [
      'ACROSS beside a layer',
      definition(capped({ settlementLayers: ['ACROSS', 'CCTP'] })),
    ],
    ["'all'", definition(capped({ settlementLayers: 'all' }))],
    ["['ACROSS'] alone", definition(capped({ settlementLayers: ['ACROSS'] }))],
    [
      "['ACROSS'] alone with every leg capped",
      definition({
        from: [
          { chain: base, token: USDC, maxAmount: 100n },
          { chain: base, token: OTHER, maxAmount: 5n },
        ],
        settlementLayers: ['ACROSS'],
      }),
    ],
  ])('does not warn for a reusable capped %s', (_, def) => {
    expect(warnings(def)).toEqual([])
  })

  test.each<[string, SessionDefinition, string]>([
    [
      "['ACROSS'] alone, one-shot",
      definition(
        {
          from: [
            { chain: base, token: USDC, maxAmount: 100n },
            { chain: base, token: OTHER },
          ],
          settlementLayers: ['ACROSS'],
        },
        once,
      ),
      "has no amount cap for a `from` token without its own maxAmount (another leg's cap does not bound it)",
    ],
    [
      "'all', the other token under the first one's cap",
      definition({
        from: [
          { chain: base, token: USDC, maxAmount: 100n },
          { chain: base, token: WETH },
        ],
        settlementLayers: 'all',
      }),
      "bounds a `from` token without its own maxAmount only by the chain's maxAmount, read in that token's raw units",
    ],
  ])('warns for an uncapped leg beside a capped one: %s', (_, def, says) => {
    expect(validateSessionDefinition(def, OPTIONS).warnings).toEqual([
      expect.objectContaining({
        code: 'UNCAPPED_ACROSS_ROUTE',
        message: expect.stringContaining(says),
        permitIndex: 0,
      }),
    ])
  })

  test('keeps an ACROSS-only permit with no maxAmount silent, as before', () => {
    expect(warnings(definition({ settlementLayers: ['ACROSS'] }))).toEqual([])
  })

  test('asks for maxAmount alone', () => {
    const [warning] = warnings(definition({ settlementLayers: 'all' }))
    expect(warning.code).toBe('UNCAPPED_ACROSS_ROUTE')
    expect(warning.message).not.toContain('oneTimeUse')
    expect(warning.message).toContain('maxAmount')
  })
})

/** Everything a session commits to, and the digest its owner signs. */
async function pin(def: SessionDefinition, options = OPTIONS) {
  const session = toSession(def, options)
  const details = await getSessionDetails({
    account: ACCOUNT,
    sessions: [session],
    environment: 'production',
    readNonce: async () => 0n,
  })
  return {
    permissionId: session.permissionId,
    fingerprint: sessionFingerprint(session),
    digest: details.hashesAndChainIds[0].sessionDigest as Hex,
  }
}

// Every shape that built before reusable sessions took maxAmount keeps its bytes.
test('one-shot capped and reusable uncapped sessions are unchanged', async () => {
  const sessions: Record<string, [SessionDefinition, ResolveSessionOptions]> = {
    'ACROSS one-shot': [
      definition(capped({ settlementLayers: ['ACROSS'] }), once),
      OPTIONS,
    ],
    'ACROSS reusable': [definition({ settlementLayers: ['ACROSS'] }), OPTIONS],
    'ACROSS reusable v1': [
      definition({ settlementLayers: ['ACROSS'] }, { saltMode: 'v1' }),
      OPTIONS,
    ],
    'ACROSS wrapped native one-shot': [
      definition(
        {
          from: { chain: base, token: WETH, maxAmount: 100n },
          to: { chain: arbitrum, token: WETH_ARB },
          settlementLayers: ['ACROSS'],
        },
        once,
      ),
      { ...OPTIONS, wrappedNativeToken: WETH },
    ],
    'ACROSS wrapped native reusable': [
      definition({
        from: { chain: base, token: WETH },
        to: { chain: arbitrum, token: WETH_ARB },
        settlementLayers: ['ACROSS'],
      }),
      { ...OPTIONS, wrappedNativeToken: WETH },
    ],
    'fallback one-shot': [
      definition(capped({ settlementLayers: ['ACROSS'] }), {
        ...once,
        fallback: 'intentExecution',
      }),
      OPTIONS,
    ],
    'fallback reusable': [
      definition(
        { settlementLayers: ['ACROSS'] },
        { fallback: 'intentExecution' },
      ),
      OPTIONS,
    ],
    'CCTP one-shot': [
      definition(capped({ settlementLayers: ['CCTP'] }), once),
      OPTIONS,
    ],
    'CCTP reusable': [definition({ settlementLayers: ['CCTP'] }), OPTIONS],
    'CCTP, ECO_IE one-shot': [
      definition(
        capped({ settlementLayers: ['CCTP', 'ECO_IE'], ...eco }),
        once,
      ),
      OPTIONS,
    ],
    'ACROSS, CCTP, LZ one-shot': [
      definition(capped({ settlementLayers: ['ACROSS', 'CCTP', 'LZ'] }), once),
      OPTIONS,
    ],
    'ACROSS, CCTP reusable': [
      definition({ settlementLayers: ['ACROSS', 'CCTP'] }),
      OPTIONS,
    ],
    'ACROSS, CCTP fees one-shot': [
      definition(
        capped({ settlementLayers: ['ACROSS', 'CCTP'], allowFees: true }),
        once,
      ),
      FEE_OPTIONS,
    ],
    "'all' one-shot": [
      definition(capped({ settlementLayers: 'all' }), once),
      OPTIONS,
    ],
    "'all' reusable": [definition({ settlementLayers: 'all' }), OPTIONS],
    'omitted layers reusable on a chain without Permit2SenderPolicy': [
      definition({}, {}, avalanche),
      OPTIONS,
    ],
    'SAME_CHAIN_IE one-shot': [
      definition(
        capped({
          to: { chain: base, token: USDC, recipient: OTHER },
          allowRecipientNotAccount: true,
          settlementLayers: ['SAME_CHAIN_IE'],
        }),
        once,
      ),
      OPTIONS,
    ],
    'CCTP two to legs one-shot': [
      definition(
        capped({
          settlementLayers: ['CCTP'],
          to: [
            { chain: arbitrum, token: USDC_ARB },
            { chain: optimism, token: USDC_OP },
          ],
        }),
        once,
      ),
      OPTIONS,
    ],
  }
  const table: Record<string, unknown> = {}
  for (const [name, [def, options]] of Object.entries(sessions)) {
    table[name] = await pin(def, options)
  }
  expect(table).toMatchInlineSnapshot(`
    {
      "'all' one-shot": {
        "digest": "0xe625012707eea9d1938bb6cbdc295004cb330e5a8ebed89e6cf426e892664280",
        "fingerprint": "0x7a503d6f9839b280977e0d3c0e82e0c01e1ff2ef2923e4afae25b30c3b1f23e7",
        "permissionId": "0xb3ff59f603d41f8b562a5dd39da8d8535c25d2cdfa9256682818a0dde4127133",
      },
      "'all' reusable": {
        "digest": "0x322d03a177cda2855a5bf842390abed5456920e3538d45d81dcda0cfcb68b94b",
        "fingerprint": "0x30a6e83b3c8db9570a3f12658a0c50ed067cdff107be38f01fdfd1a6509b3bc3",
        "permissionId": "0x4de939233dbae347ced85ecb27d7b03c99397d6f7a83bfb9cfd5c4e2d411bae1",
      },
      "ACROSS one-shot": {
        "digest": "0x12a8342259d2fa27389638cada75bbf3f515a556ac760064a02650207ea2e9cc",
        "fingerprint": "0x4fe4c75ff64257c202b5fe56e9c7be1c5cd7a2874eb4a604b1a29ed2c1c34f87",
        "permissionId": "0xf8947e7a47b9ec2d6ceb3d5faa0ff3d3826e0a7c3d2518e7bdfd662e0dd956b8",
      },
      "ACROSS reusable": {
        "digest": "0x0cf3234b9e6502788ea5f8d35bc1831b04a3014c7b17bd4dea641be3f51cb4f1",
        "fingerprint": "0x2595c91322217fa573a681138606efea48badfa7a31db3be0def1b650c0b9d57",
        "permissionId": "0x3389be403cc6e402c691786e18697b3277601754b6fcfc91675351460a79ce9f",
      },
      "ACROSS reusable v1": {
        "digest": "0x0cf3234b9e6502788ea5f8d35bc1831b04a3014c7b17bd4dea641be3f51cb4f1",
        "fingerprint": "0x2595c91322217fa573a681138606efea48badfa7a31db3be0def1b650c0b9d57",
        "permissionId": "0x3389be403cc6e402c691786e18697b3277601754b6fcfc91675351460a79ce9f",
      },
      "ACROSS wrapped native one-shot": {
        "digest": "0x1f87f09e0f53bd35422ff011800d952d1407635ce7d69ff2fe644d5b4b599933",
        "fingerprint": "0xd6a130649d0f400c083b0209af48b38ab320baf03ad63c1c5ebe2a2a79bce097",
        "permissionId": "0xcb410215b9c9f4593dbaf0a1b225c7d7ee15db4b25a05421ef75cc1e6552e213",
      },
      "ACROSS wrapped native reusable": {
        "digest": "0x927ea92b6c27e263c48b3c3fa938def995561af2d71e8d32fef5413a2b31fbd6",
        "fingerprint": "0xb1059d80924262d87dbb6c8d0a6c9da66fbb87a1e9c56797adebf2ecc23ba09d",
        "permissionId": "0xd1c817946d7a00f056cc7640c6f8e4e3ffa4080f0991e1401a707fdc987e00c6",
      },
      "ACROSS, CCTP fees one-shot": {
        "digest": "0x261317e9a341287d44709d66b32bdd38a933fcb18ec5faf5e844f443ba171fe5",
        "fingerprint": "0xf24ce4599b19ebfd54b244a4310bfc59069ba7887bf63bc8e7e15a2ebcbc2ff1",
        "permissionId": "0x37e74746a1dcde50308ec054f8eaed21a26b49d5d2f6d19fe55df0fa94ac3adb",
      },
      "ACROSS, CCTP reusable": {
        "digest": "0x322d03a177cda2855a5bf842390abed5456920e3538d45d81dcda0cfcb68b94b",
        "fingerprint": "0x30a6e83b3c8db9570a3f12658a0c50ed067cdff107be38f01fdfd1a6509b3bc3",
        "permissionId": "0x4de939233dbae347ced85ecb27d7b03c99397d6f7a83bfb9cfd5c4e2d411bae1",
      },
      "ACROSS, CCTP, LZ one-shot": {
        "digest": "0xe625012707eea9d1938bb6cbdc295004cb330e5a8ebed89e6cf426e892664280",
        "fingerprint": "0x7a503d6f9839b280977e0d3c0e82e0c01e1ff2ef2923e4afae25b30c3b1f23e7",
        "permissionId": "0xb3ff59f603d41f8b562a5dd39da8d8535c25d2cdfa9256682818a0dde4127133",
      },
      "CCTP one-shot": {
        "digest": "0x2d3766133f62005b198e0089d524c9064c2b4b0439b6c79199ee5b108e2868d5",
        "fingerprint": "0xae537ab048f12347a905df01f3bb61b0c45dd83cb728081c7cae5bd29a255d9e",
        "permissionId": "0x472400c79926d2cab1e4f70e61cbd950c456d8dd11313b4235d8e7c0519ebf66",
      },
      "CCTP reusable": {
        "digest": "0x76a9493f3adf059496b5ac856b5b05650dd9f733ee5a2d4abf1e5421090462d6",
        "fingerprint": "0xa76668190a491370ec60b7d347413d7a4b5cd3aa158bd57bb027d6f8f379e34e",
        "permissionId": "0x549544b095b60a108f9c681386b975d179efd2ae76cfede5555282d645a5b6fe",
      },
      "CCTP two to legs one-shot": {
        "digest": "0x10f0b26ea1376578ebb239c2449bb8fb54402a51564a5774e0accb6b0b3c525d",
        "fingerprint": "0x588d9bf81b766c80b91fb90439bdfd897b22e4b1e82ebdc3b1d4420505048552",
        "permissionId": "0x7e58ac5b34bd9c4761d0e484b88b197a062563feaa837019f0508b0d5fff9116",
      },
      "CCTP, ECO_IE one-shot": {
        "digest": "0x5aad6f6f4ddae14fa252f07f7c65ae2c982ef206d10758834d0921e72f778743",
        "fingerprint": "0x82ed2095dc970079329d438a0f550e97c8f81183b299684b1865c8cef2aee656",
        "permissionId": "0xd76df448bd68468db27bcfd84c259c9914f7ddc6a964f2304cf507dccb9de3b5",
      },
      "SAME_CHAIN_IE one-shot": {
        "digest": "0x9440c31bda0ac014d4159c149a2269d36baf20eb9a5f13a9e146c6a40fc0feba",
        "fingerprint": "0x390e1bf46dce7838b94076a21ebb19a4205f612ac2701bea08f2b501fdd036a4",
        "permissionId": "0x4455d6c1875a83cf51477cd84cac4dacf2fe7ddd7eb6cdc8f1c1f17230f7174e",
      },
      "fallback one-shot": {
        "digest": "0x698d9cd55654a18c002b858b8d597c91692d826c5df95b911859ab7d92273f2a",
        "fingerprint": "0x72ef9b7b86f3390321084d3fbcfdf52eef12169ca4a121cae7c2369462c604ea",
        "permissionId": "0x8d704b536b52c491a7819de74dadb2295452fd50ba4f049e844c5d3421da4904",
      },
      "fallback reusable": {
        "digest": "0xecbef41632e1f91e99a76dc68f9550eb9e11d13a1a8ff6a980c3b0d8a0871f4b",
        "fingerprint": "0x465ce634e30b33f8eabd7611324926f60e16ee19f30d2e2fc844d839f627d1fc",
        "permissionId": "0x1bed04f1dab12e3ccb1ec7e62815b8ca9d92440c556ff58049254998e580556b",
      },
      "omitted layers reusable on a chain without Permit2SenderPolicy": {
        "digest": "0x5b68892c05d3c71af838729a140a0e8fe15c3b1fbeeb5ef012a9f44e725ff236",
        "fingerprint": "0x845eb354b2da127260fc31da862d75babb65329c9bc3be0f1cb8ea94606bdf32",
        "permissionId": "0x96420ead777ac5b5812fe9aba5744d9075a60cb31079d2d120643d5e15e4f622",
      },
    }
  `)
})

describe('signing the enable of a session with a lifetime budget', () => {
  const reusable = toSession(
    definition(capped({ settlementLayers: ['ACROSS'] })),
    OPTIONS,
  )
  const fresh = toSession(
    definition(
      {
        from: { chain: optimism, token: USDC_OP, maxAmount: 100n },
        settlementLayers: ['CCTP'],
      },
      {},
      optimism,
    ),
    OPTIONS,
  )
  const unflagged = (session: Session): Session => {
    const { lifetimeBudget: _, ...rest } = session
    return rest
  }
  /** A chain where `enabled` decides each session's state at the read's block. */
  const details = (
    sessions: Session[],
    enabled: (session: Session) => boolean,
    allowBudgetReset?: boolean,
  ) => {
    const readNonce = vi.fn(async () => 3n)
    const readNonceAndEnabled = vi.fn(async (session: Session) => ({
      nonce: 4n,
      enabled: enabled(session),
    }))
    return {
      readNonce,
      readNonceAndEnabled,
      result: getSessionDetails({
        account: ACCOUNT,
        sessions,
        environment: 'production',
        readNonce,
        readNonceAndEnabled,
        ...(allowBudgetReset === undefined ? {} : { allowBudgetReset }),
      }),
    }
  }

  test('marks only reusable capped sessions', () => {
    expect(reusable.lifetimeBudget).toBe(true)
    expect(fresh.lifetimeBudget).toBe(true)
    expect(hasLifetimeBudget(reusable)).toBe(true)
    for (const def of [
      definition(capped({ settlementLayers: ['ACROSS'] }), once),
      definition({ settlementLayers: ['ACROSS'] }),
      definition({ settlementLayers: ['CCTP'] }),
    ]) {
      const session = toSession(def, OPTIONS)
      expect(session.lifetimeBudget).toBeUndefined()
      expect(hasLifetimeBudget(session)).toBe(false)
    }
  })

  test.each<[string, SessionDefinition]>([
    ["['ACROSS']", definition(capped({ settlementLayers: ['ACROSS'] }))],
    ["['CCTP']", definition(capped({ settlementLayers: ['CCTP'] }))],
    [
      "['ACROSS', 'CCTP'] with allowFees",
      definition(
        capped({ settlementLayers: ['ACROSS', 'CCTP'], allowFees: true }),
      ),
    ],
    ["'all'", definition(capped({ settlementLayers: 'all' }))],
  ])('finds the budget in the actions of %s without the flag', (_, def) => {
    const options = def.crossChainPermits?.[0].allowFees ? FEE_OPTIONS : OPTIONS
    expect(hasLifetimeBudget(unflagged(toSession(def, options)))).toBe(true)
  })

  test('finds no budget in the actions of one-shot, uncapped or fee-only sessions', () => {
    for (const [def, options] of [
      [definition(capped({ settlementLayers: ['ACROSS'] }), once), OPTIONS],
      [
        definition(capped({ settlementLayers: ['ACROSS', 'CCTP'] }), once),
        OPTIONS,
      ],
      [definition({ settlementLayers: ['ACROSS', 'CCTP'] }), OPTIONS],
      [
        definition({ settlementLayers: ['CCTP'], allowFees: true }),
        FEE_OPTIONS,
      ],
    ] as const) {
      const session = toSession(def, options)
      const { oneTimeUse: _, ...stripped } = unflagged(session)
      expect(hasLifetimeBudget(stripped)).toBe(false)
    }
  })

  test('refuses one already enabled, as its enable would reset the budget', async () => {
    const { result } = details([reusable], () => true)
    await expect(result).rejects.toThrow(
      `already enabled on chain ${base.id}, and its maxAmount is a lifetime budget`,
    )
  })

  test('refuses a stored session whose flag was dropped', async () => {
    const { result } = details([unflagged(reusable)], () => true)
    await expect(result).rejects.toThrow('allowBudgetReset')
  })

  test('takes the nonce from the same read as the enabled state', async () => {
    const { result, readNonce } = details([reusable], () => false)
    await expect(result).resolves.toMatchObject({ nonces: [4n] })
    expect(readNonce).not.toHaveBeenCalled()
  })

  test('refuses a bundle with one session enabled and one not', async () => {
    const { result } = details(
      [reusable, fresh],
      (session) => session === reusable,
    )
    await expect(result).rejects.toThrow('allowBudgetReset')
  })

  test('signs the one not enabled when it comes alone', async () => {
    const { result } = details([fresh], (session) => session === reusable)
    await expect(result).resolves.toMatchObject({ nonces: [4n] })
  })

  test('signs it when the caller opts in to the reset, with no state read', async () => {
    const { result, readNonceAndEnabled } = details(
      [reusable],
      () => true,
      true,
    )
    await expect(result).resolves.toMatchObject({ nonces: [3n] })
    expect(readNonceAndEnabled).not.toHaveBeenCalled()
  })

  test('signs sessions not yet enabled, alone or beside another chain', async () => {
    const { result } = details([reusable, fresh], () => false)
    await expect(result).resolves.toMatchObject({ nonces: [4n, 4n] })
  })

  test('reads nothing more for sessions without a lifetime budget, and signs them as before', async () => {
    const plain = [
      toSession(definition({ settlementLayers: ['ACROSS'] }), OPTIONS),
      toSession(
        definition(capped({ settlementLayers: ['ACROSS'] }), once),
        OPTIONS,
      ),
    ]
    const { result, readNonceAndEnabled } = details(plain, () => true)
    const without = await getSessionDetails({
      account: ACCOUNT,
      sessions: plain,
      environment: 'production',
      readNonce: async () => 3n,
    })
    expect(await result).toEqual(without)
    expect(readNonceAndEnabled).not.toHaveBeenCalled()
  })

  test('fails closed when no state read is wired', async () => {
    await expect(
      getSessionDetails({
        account: ACCOUNT,
        sessions: [reusable],
        environment: 'production',
        readNonce: async () => 3n,
      }),
    ).rejects.toThrow('needs readNonceAndEnabled')
  })
})
