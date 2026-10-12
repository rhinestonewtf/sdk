import {
  type Address,
  type Chain,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  isAddressEqual,
  toFunctionSelector,
  zeroAddress,
} from 'viem'
import { arbitrum, avalanche, base, optimism } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { accountA } from '../../../../test/consts'
import { admits, install } from '../../../../test/utils/installed-policies'
import {
  type RuleUsage,
  satisfiesRules,
} from '../../../../test/utils/policy-rules'
import { sessionFingerprint } from '../../../../test/utils/session-fingerprint'
import { SETTLEMENT_CATALOG } from '../../../../test/utils/settlement-catalog'
import { getArbitersForSettlementLayers } from '../policies/claim/arbiters'
import { PERMIT2_CLAIM_POLICY_ADDRESS } from '../policies/claim/permit2'
import { getSessionDetails } from './authorization'
import { resolveCrossChainPermission } from './cross-chain-permits'
import { CONSUME_FOR_SELECTOR, CONSUME_SELECTOR } from './one-time-use'
import {
  DEFAULT_POLICY_ADDRESSES,
  PERMIT2_SENDER_POLICY_ADDRESS,
  UNIVERSAL_ACTION_POLICY_COPIES,
} from './policies/addresses'
import {
  type ResolveSessionOptions,
  resolveSessionData,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  toSession,
  validateSessionDefinition,
} from './resolve'
import { DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR } from './settlement/cctp'
import { resolveSettlementScope } from './settlement/scope'
import { PERMIT2 } from './swap/stable-floor'
import type {
  CrossChainPermissionInput,
  ScopedAction,
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
const APPROVE = toFunctionSelector('approve(address,uint256)')
const BASE = SETTLEMENT_CATALOG[base.id]
const USDC = BASE.cctp!.usdc
const USDC_ARB = SETTLEMENT_CATALOG[arbitrum.id].cctp!.usdc
const USDC_AVAX = SETTLEMENT_CATALOG[avalanche.id].cctp!.usdc
const USDC_OP = SETTLEMENT_CATALOG[optimism.id].cctp!.usdc
const MESSENGER = BASE.cctp!.tokenMessenger
const DELEGATE = BASE.lz!.transferDelegate
const VALID_UNTIL = new Date(2_000_000_000_000)
const OPTIONS: ResolveSessionOptions = { settlement: SETTLEMENT_CATALOG }
const PAYMASTER = '0x6666666666666666666666666666666666666666' as Address
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
const WETH = '0x4200000000000000000000000000000000000006' as Address
const WETH_ARB = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1' as Address

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

const codes = (def: SessionDefinition, options = OPTIONS) =>
  validateSessionDefinition(def, options).refusals.map(({ code }) => code)

const approve = (spender: Address, amount = 100n) =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  })

const targets = (def: SessionDefinition) =>
  resolveSessionData(def, OPTIONS).actions.map(
    (a) => [a.actionTarget, a.actionTargetSelector] as const,
  )

const erc1271 = (def: SessionDefinition) =>
  resolveSessionData(def, OPTIONS).erc7739Policies.erc1271Policies

/** The settlement scope's approve, with ACROSS kept beside the named layers. */
function scopedApprove(permit: Partial<CrossChainPermissionInput>) {
  const input = definition(capped(permit)).crossChainPermits?.[0] ?? {}
  const scope = resolveSettlementScope([resolveCrossChainPermission(input)], {
    chainId: base.id,
    environment: 'production',
    account: ACCOUNT,
    oneTimeUse: true,
    settlement: SETTLEMENT_CATALOG,
    across: {},
  })
  const approves = (scope?.actions ?? []).filter(
    (a): a is ScopedAction => a.selector === APPROVE,
  )
  expect(approves).toHaveLength(1)
  return approves[0]
}

describe('a permit naming ACROSS beside IntentExecutor layers', () => {
  test('compiles to the union of both surfaces, with no wildcard', () => {
    const def = definition(
      capped({ settlementLayers: ['ACROSS', 'CCTP'] }),
      once,
    )
    const session = toSession(def, OPTIONS)
    expect(session.settlementLayers).toEqual(['ACROSS', 'CCTP'])
    expect(session.access).toEqual({
      kind: 'scoped',
      reason: 'settlement-scoped permit (ACROSS, CCTP)',
    })
    expect(session.hasExplicitPermissions).toBe(true)
    expect(targets(def)).toEqual([
      [MESSENGER, DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR],
      [USDC, APPROVE],
      [ONE_TIME_USE, CONSUME_SELECTOR],
      [ONE_TIME_USE, CONSUME_FOR_SELECTOR],
    ])
    expect(
      targets(def).some(([target]) =>
        isAddressEqual(target, SMART_SESSIONS_FALLBACK_TARGET_FLAG),
      ),
    ).toBe(false)
    expect(erc1271(def).map(({ policy }) => policy)).toEqual([
      PERMIT2_CLAIM_POLICY_ADDRESS,
      ONE_TIME_USE,
    ])
    expect(session.claimPolicies).toEqual([
      expect.objectContaining({
        spenders: getArbitersForSettlementLayers(['ACROSS']),
        recipientIsAccount: true,
      }),
    ])
    expect(session.permit2Sources).toEqual([
      { chain: base, token: USDC, maxAmount: 100n },
    ])
  })

  test("leaves each IntentExecutor layer's calldata pins as they are alone", () => {
    const pinned = {
      to: { chain: arbitrum, token: USDC_ARB, recipient: OTHER },
      allowRecipientNotAccount: true,
    } as const
    const cctpCall = (layers: CrossChainPermissionInput['settlementLayers']) =>
      resolveSessionData(
        definition(capped({ ...pinned, settlementLayers: layers }), once),
        OPTIONS,
      ).actions.find((a) => isAddressEqual(a.actionTarget, MESSENGER))
    expect(cctpCall(['ACROSS', 'CCTP'])).toEqual(cctpCall(['CCTP']))
    // The ACROSS claim pins the same recipient.
    expect(
      toSession(
        definition(
          capped({ ...pinned, settlementLayers: ['ACROSS', 'CCTP'] }),
          once,
        ),
        OPTIONS,
      ).claimPolicies[0].recipients,
    ).toEqual([{ chain: arbitrum, address: OTHER }])
  })

  test('maxAmount is one budget across approve(Permit2) and the layers', () => {
    const action = scopedApprove({ settlementLayers: ['ACROSS', 'CCTP', 'LZ'] })
    for (const spender of [PERMIT2, MESSENGER, DELEGATE]) {
      expect(satisfiesRules(action, approve(spender))).toBe(true)
      expect(satisfiesRules(action, approve(spender, 101n))).toBe(false)
    }
    expect(satisfiesRules(action, approve(OTHER, 1n))).toBe(false)
    const usage: RuleUsage = new Map()
    expect(satisfiesRules(action, approve(PERMIT2, 60n), usage)).toBe(true)
    expect(satisfiesRules(action, approve(MESSENGER, 41n), usage)).toBe(false)
    expect(satisfiesRules(action, approve(DELEGATE, 40n), usage)).toBe(true)
    expect(satisfiesRules(action, approve(PERMIT2, 1n), usage)).toBe(false)
  })

  test('the Permit2 route adds no approve of its own', () => {
    const approves = targets(
      definition(capped({ settlementLayers: ['ACROSS', 'CCTP'] }), once),
    ).filter(([, selector]) => selector === APPROVE)
    expect(approves).toEqual([[USDC, APPROVE]])
  })

  test('maxAmount without oneTimeUse builds, as a lifetime cap', () => {
    expect(
      codes(definition(capped({ settlementLayers: ['ACROSS', 'CCTP'] }))),
    ).toEqual([])
  })

  test('oneTimeUse burns the same id on either route', () => {
    const data = resolveSessionData(
      definition(capped({ settlementLayers: ['ACROSS', 'CCTP'] }), once),
      OPTIONS,
    )
    const [burn] = data.erc7739Policies.erc1271Policies.filter(({ policy }) =>
      isAddressEqual(policy, ONE_TIME_USE),
    )
    expect(burn).toBeDefined()
    for (const action of data.actions) {
      expect(action.actionPolicies).toContainEqual(burn)
    }
    // The executor route burns with consume, the Permit2 pre-claim with consumeFor.
    for (const selector of [CONSUME_SELECTOR, CONSUME_FOR_SELECTOR]) {
      expect(
        data.actions.find(
          (a) =>
            isAddressEqual(a.actionTarget, ONE_TIME_USE) &&
            a.actionTargetSelector === selector,
        )?.actionPolicies,
      ).toEqual([burn])
    }
    expect(
      data.erc7739Policies.erc1271Policies.map(({ policy }) => policy),
    ).not.toContain(PERMIT2_SENDER_POLICY_ADDRESS)
  })

  test('a reusable session bounds the ACROSS claim with Permit2SenderPolicy', () => {
    const def = definition({ settlementLayers: ['ACROSS', 'CCTP'] })
    expect(codes(def)).toEqual([])
    expect(erc1271(def).map(({ policy }) => policy)).toEqual([
      PERMIT2_CLAIM_POLICY_ADDRESS,
      PERMIT2_SENDER_POLICY_ADDRESS,
    ])
  })

  test("preClaimOps: 'none' bounds it where no Permit2SenderPolicy is deployed", () => {
    const layers: Partial<CrossChainPermissionInput> = {
      settlementLayers: ['ACROSS', 'CCTP'],
    }
    expect(codes(definition(layers, {}, avalanche))).toEqual([
      'PERMIT2_ROUTE_NEEDS_BOUND',
    ])
    const bounded = definition(
      { ...layers, preClaimOps: 'none' },
      {},
      avalanche,
    )
    expect(codes(bounded)).toEqual([])
    expect(erc1271(bounded).map(({ policy }) => policy)).toEqual([
      PERMIT2_CLAIM_POLICY_ADDRESS,
    ])
  })

  test.each<[string, Partial<CrossChainPermissionInput>]>([
    ['one leg without a recipient', {}],
    [
      'a pinned leg and one without a recipient',
      {
        to: [
          { chain: arbitrum, token: USDC_ARB, recipient: OTHER },
          { chain: optimism, token: USDC_OP },
        ],
      },
    ],
  ])(
    'the ACROSS claim pins the account as the layers do, with %s',
    (_, permit) => {
      const def = definition(
        capped({ allowRecipientNotAccount: true, ...permit }),
        once,
      )
      const session = toSession(def, OPTIONS)
      expect(session.settlementLayers).toContain('ACROSS')
      const legs = [def.crossChainPermits?.[0].to ?? []].flat()
      const expected = legs.map(({ chain, recipient }) => ({
        chain,
        address: recipient ?? ACCOUNT,
      }))
      expect(session.claimPolicies[0].recipients).toEqual(expected)
      // The installed claim and the CCTP call both carry every pinned recipient.
      const data = resolveSessionData(def, OPTIONS)
      const claim = data.erc7739Policies.erc1271Policies.find(({ policy }) =>
        isAddressEqual(policy, PERMIT2_CLAIM_POLICY_ADDRESS),
      )
      const cctpCall = data.actions.find((a) =>
        isAddressEqual(a.actionTarget, MESSENGER),
      )
      for (const { address } of expected) {
        const word = address.slice(2).toLowerCase()
        expect(claim?.initData.toLowerCase()).toContain(word)
        expect(
          cctpCall?.actionPolicies.some(({ initData }) =>
            initData.toLowerCase().includes(word),
          ),
        ).toBe(true)
      }
    },
  )

  test.each<[string, SessionDefinition, string]>([
    [
      'SAME_CHAIN_IE',
      definition({
        to: { chain: base, token: USDC, recipient: OTHER },
        allowRecipientNotAccount: true,
        settlementLayers: ['ACROSS', 'SAME_CHAIN_IE'],
      }),
      'SAME_CHAIN_IE_WITH_OTHER_LAYERS',
    ],
    [
      'a Permit2 layer other than ACROSS',
      definition({ settlementLayers: ['ACROSS', 'SAME_CHAIN', 'CCTP'] }),
      'PERMIT2_LAYER_WITH_INTENT_EXECUTOR_LAYER',
    ],
    [
      'a `to.minAmount` ACROSS cannot enforce',
      definition(
        capped({
          to: { chain: arbitrum, token: USDC_ARB, minAmount: 99n },
          settlementLayers: ['ACROSS', 'ECO_IE'],
          validUntil: VALID_UNTIL,
        }),
        once,
      ),
      'MIN_AMOUNT_ON_PERMIT2_LAYER',
    ],
    [
      'a fillDeadline the IntentExecutor layers cannot enforce',
      definition({
        settlementLayers: ['ACROSS', 'CCTP'],
        fillDeadline: [{ chain: arbitrum, max: VALID_UNTIL }],
      }),
      'FILL_DEADLINE_ONLY_PERMIT2',
    ],
    [
      'maxFeeBps without ECO_IE',
      definition({ settlementLayers: ['ACROSS', 'CCTP'], maxFeeBps: 50 }),
      'MAX_FEE_BPS_ONLY_ECO_IE',
    ],
    [
      'maxFeeBps, which ACROSS cannot enforce, beside ECO_IE',
      definition(
        capped({
          settlementLayers: ['ACROSS', 'ECO_IE'],
          maxFeeBps: 50,
          validUntil: VALID_UNTIL,
        }),
        once,
      ),
      'MAX_FEE_BPS_ONLY_ECO_IE',
    ],
    [
      'a signing surface',
      definition(
        { settlementLayers: ['ACROSS', 'CCTP'] },
        { signing: { mode: 'unrestricted' } },
      ),
      'SIGNING_WITH_INTENT_EXECUTOR_PERMIT',
    ],
    [
      "saltMode 'v1'",
      definition({ settlementLayers: ['ACROSS', 'CCTP'] }, { saltMode: 'v1' }),
      'SETTLEMENT_SCOPED_SALT_V1',
    ],
    [
      'a declared approve on the `from` token',
      definition(
        { settlementLayers: ['ACROSS', 'CCTP'] },
        { actions: [{ target: USDC, selector: APPROVE }] },
      ),
      'PERMIT2_APPROVE_CONFLICT',
    ],
    [
      'claimPolicies',
      definition(
        { settlementLayers: ['ACROSS', 'CCTP'] },
        { claimPolicies: [{ type: 'permit2' }] },
      ),
      'RESTRICTED_WITH_PERMIT2_GRANTS',
    ],
    [
      "preClaimOps: 'none' with oneTimeUse",
      definition(
        { settlementLayers: ['ACROSS', 'CCTP'], preClaimOps: 'none' },
        once,
      ),
      'PRE_CLAIM_OPS_NOT_APPLICABLE',
    ],
    [
      '`fallback`',
      definition(
        { settlementLayers: ['ACROSS', 'CCTP'] },
        { fallback: 'intentExecution' },
      ),
      'PERMIT2_LAYER_WITH_INTENT_EXECUTOR_LAYER',
    ],
    [
      'a separate Permit2-layer permit',
      {
        ...definition({ settlementLayers: ['ACROSS', 'CCTP'] }),
        crossChainPermits: [
          ...(definition({ settlementLayers: ['ACROSS', 'CCTP'] })
            .crossChainPermits ?? []),
          ...(definition({ settlementLayers: ['ACROSS'] }).crossChainPermits ??
            []),
        ],
      },
      'MIXED_PERMIT_KINDS',
    ],
  ])('refuses %s', (_, def, code) => {
    expect(codes(def)).toContain(code)
    expect(() => toSession(def, OPTIONS)).toThrow(
      expect.objectContaining({ code }),
    )
  })
})

describe("settlementLayers 'all'", () => {
  test('keeps ACROSS where it can settle', () => {
    const reusable = toSession(definition({ settlementLayers: 'all' }), OPTIONS)
    expect(reusable.settlementLayers).toEqual(['ACROSS', 'CCTP'])
    expect(
      reusable.settlementCoverage?.dropped.map(({ layer }) => layer),
    ).not.toContain('ACROSS')
    const oneShot = definition(capped({ settlementLayers: 'all' }), once)
    expect(toSession(oneShot, OPTIONS).settlementLayers).toEqual([
      'ACROSS',
      'CCTP',
      'LZ',
    ])
    expect(resolveSessionData(oneShot, OPTIONS)).toEqual(
      resolveSessionData(
        definition(
          capped({ settlementLayers: ['ACROSS', 'CCTP', 'LZ'] }),
          once,
        ),
        OPTIONS,
      ),
    )
  })

  test.each<[string, SessionDefinition, string, string]>([
    [
      'on a chain without Permit2SenderPolicy, for a reusable session',
      definition({ settlementLayers: 'all' }, {}, avalanche),
      'PERMIT2_ROUTE_NEEDS_BOUND',
      `a Permit2-layer permit needs one of oneTimeUse, preClaimOps: 'none', Permit2SenderPolicy, fallback; chain ${avalanche.id} has no Permit2SenderPolicy`,
    ],
    [
      'with a `to.minAmount`',
      definition(
        capped({
          to: { chain: arbitrum, token: USDC_ARB, minAmount: 99n },
          settlementLayers: 'all',
          validUntil: VALID_UNTIL,
        }),
        once,
      ),
      'MIN_AMOUNT_ON_PERMIT2_LAYER',
      '`to.minAmount` does not apply to Permit2 layers',
    ],
    [
      'with maxFeeBps',
      definition(
        capped({
          settlementLayers: 'all',
          maxFeeBps: 50,
          validUntil: VALID_UNTIL,
        }),
        once,
      ),
      'MAX_FEE_BPS_ONLY_ECO_IE',
      'maxFeeBps applies only to ECO_IE',
    ],
  ])(
    'drops ACROSS %s, with the refusal naming it throws',
    (_, def, code, reason) => {
      const { settlementLayers, settlementCoverage } = toSession(def, OPTIONS)
      expect(settlementLayers).not.toContain('ACROSS')
      expect(settlementLayers?.length).toBeGreaterThan(0)
      expect(settlementCoverage?.dropped[0]).toEqual({
        layer: 'ACROSS',
        reason,
      })
      const [permit] = def.crossChainPermits ?? []
      const named = {
        ...def,
        crossChainPermits: [{ ...permit, settlementLayers: ['ACROSS'] }],
      } as SessionDefinition
      expect(validateSessionDefinition(named, OPTIONS).refusals[0]).toEqual(
        expect.objectContaining({
          code,
          message: `crossChainPermits: ${reason}`,
        }),
      )
    },
  )

  test("preClaimOps: 'none' keeps ACROSS where no Permit2SenderPolicy is deployed", () => {
    expect(
      toSession(
        definition(
          { settlementLayers: 'all', preClaimOps: 'none' },
          {},
          avalanche,
        ),
        OPTIONS,
      ).settlementLayers,
    ).toEqual(['ACROSS', 'CCTP'])
  })

  test('names ACROSS among the layers that cannot settle', () => {
    expect(() =>
      toSession(
        definition({
          from: { chain: base, token: zeroAddress },
          settlementLayers: 'all',
        }),
        OPTIONS,
      ),
    ).toThrow(
      'ACROSS: a Permit2-layer `from` must be an ERC-20, e.g. the wrapped native token',
    )
  })

  test('with a fillDeadline keeps ACROSS alone', () => {
    const fillDeadline = [{ chain: arbitrum, max: VALID_UNTIL }]
    const { settlementLayers, settlementCoverage } = toSession(
      definition({ settlementLayers: 'all', fillDeadline }),
      OPTIONS,
    )
    expect(settlementLayers).toEqual(['ACROSS'])
    expect(settlementCoverage?.dropped).toEqual(
      ['CCTP', 'OFT', 'ECO_IE', 'LZ'].map((layer) => ({
        layer,
        reason: 'fillDeadline applies only to Permit2 layers',
      })),
    )
    // Where ACROSS cannot settle either, the field is refused as before.
    expect(
      codes(
        definition({ settlementLayers: 'all', fillDeadline }, {}, avalanche),
      ),
    ).toContain('FILL_DEADLINE_ONLY_PERMIT2')
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

// Sessions that name only ACROSS, or only IntentExecutor layers, keep their
// bytes: a change is a new permissionId and enable digest for every one signed.
test('explicit ACROSS-only and IntentExecutor-only sessions are unchanged', async () => {
  const sessions: Record<string, SessionDefinition> = {
    'ACROSS reusable': definition({ settlementLayers: ['ACROSS'] }),
    'ACROSS one-shot': definition(
      capped({ settlementLayers: ['ACROSS'] }),
      once,
    ),
    "ACROSS preClaimOps 'none'": definition(
      { settlementLayers: ['ACROSS'], preClaimOps: 'none' },
      {},
      avalanche,
    ),
    'ACROSS window': definition({
      settlementLayers: ['ACROSS'],
      validAfter: new Date(1_000_000_000_000),
      validUntil: VALID_UNTIL,
    }),
    CCTP: definition({ settlementLayers: ['CCTP'] }),
    'CCTP, LZ one-shot': definition(
      capped({ settlementLayers: ['CCTP', 'LZ'] }),
      once,
    ),
    ECO_IE: definition(
      capped({
        settlementLayers: ['ECO_IE'],
        maxFeeBps: 50,
        validUntil: VALID_UNTIL,
      }),
      once,
    ),
    SAME_CHAIN_IE: definition({
      to: { chain: base, token: USDC, recipient: OTHER },
      allowRecipientNotAccount: true,
      settlementLayers: ['SAME_CHAIN_IE'],
    }),
  }
  const table: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(sessions)) {
    table[name] = await pin(def)
  }
  expect(table).toMatchInlineSnapshot(`
    {
      "ACROSS one-shot": {
        "digest": "0x12a8342259d2fa27389638cada75bbf3f515a556ac760064a02650207ea2e9cc",
        "fingerprint": "0x4fe4c75ff64257c202b5fe56e9c7be1c5cd7a2874eb4a604b1a29ed2c1c34f87",
        "permissionId": "0xf8947e7a47b9ec2d6ceb3d5faa0ff3d3826e0a7c3d2518e7bdfd662e0dd956b8",
      },
      "ACROSS preClaimOps 'none'": {
        "digest": "0x2ac4aadd1c546a02cf4b5f36fd997db2daa19bd02422c4924a3e9d113d8b216e",
        "fingerprint": "0x29866df84922f986217fdff0b2279f8984fe004f24e526e902e887dbb57b3d70",
        "permissionId": "0xccc0849e3e762a3f5922a74a319cfdbebde9f2bdd82d520f84d382be74515921",
      },
      "ACROSS reusable": {
        "digest": "0x0cf3234b9e6502788ea5f8d35bc1831b04a3014c7b17bd4dea641be3f51cb4f1",
        "fingerprint": "0x2595c91322217fa573a681138606efea48badfa7a31db3be0def1b650c0b9d57",
        "permissionId": "0x3389be403cc6e402c691786e18697b3277601754b6fcfc91675351460a79ce9f",
      },
      "ACROSS window": {
        "digest": "0x05aee33a6518b5428fb344ab3587de54a6f9b91c74218baa012c7d2585f03325",
        "fingerprint": "0x1c83a0ebd50d7a0b31221d6fbd03f4ae886c38b93db6b3e3f0381cb7a0764a1c",
        "permissionId": "0x02e3d5dc4397c0ba29c854e31fea28f25392cab1705056770fab2f912840d40d",
      },
      "CCTP": {
        "digest": "0x76a9493f3adf059496b5ac856b5b05650dd9f733ee5a2d4abf1e5421090462d6",
        "fingerprint": "0xa76668190a491370ec60b7d347413d7a4b5cd3aa158bd57bb027d6f8f379e34e",
        "permissionId": "0x549544b095b60a108f9c681386b975d179efd2ae76cfede5555282d645a5b6fe",
      },
      "CCTP, LZ one-shot": {
        "digest": "0x7bfd0d6029d154d44da1d2101a0372bdde530b8cddd4bfe6b5dc5b204c7a765c",
        "fingerprint": "0xcefcbb231018bdad57004d246e1b6955dd3b79f7bd405638420af0157d190141",
        "permissionId": "0x3eec307370b18c85c79687dbf7bb4f02b3b0630b9a0f3ced836509c647c255a2",
      },
      "ECO_IE": {
        "digest": "0x0432999d68fce3e7b8c0f58e8c680b445225108708b3e6a228d9e41047507c90",
        "fingerprint": "0x76d78cf8e4b49a89badc623252c323f060d36fe13553d8689136bff93e20a007",
        "permissionId": "0x881d134dd473d97a4e889e1f33934757ab4a12e3aa584a613b22c2c1b41d0314",
      },
      "SAME_CHAIN_IE": {
        "digest": "0xc385b8ad8b56de826acd4875bda1c87fbfbabc1f9aa7191fa8f84c31e85acb0e",
        "fingerprint": "0x0560a124a385639cc6a3226cd3dc81f6006315db003fdb7c94e5d1849989c7e5",
        "permissionId": "0x007e5181926762b7d0532c9621bd0bf44c7554ff59e2761abbdd896f73f9d568",
      },
    }
  `)
})

test('explicit sessions with fees, a wrap, or several legs are unchanged', async () => {
  const twoLegs = [
    { chain: arbitrum, token: USDC_ARB },
    { chain: optimism, token: USDC_OP },
  ]
  const sessions: Record<string, [SessionDefinition, ResolveSessionOptions]> = {
    'ACROSS fees one-shot': [
      definition(
        capped({ settlementLayers: ['ACROSS'], allowFees: true }),
        once,
      ),
      FEE_OPTIONS,
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
    'ACROSS two to legs': [
      definition({ settlementLayers: ['ACROSS'], to: twoLegs }),
      OPTIONS,
    ],
    'ACROSS two from tokens one-shot': [
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
      OPTIONS,
    ],
    'CCTP fees': [
      definition({ settlementLayers: ['CCTP'], allowFees: true }),
      FEE_OPTIONS,
    ],
    'CCTP two to legs': [
      definition({ settlementLayers: ['CCTP'], to: twoLegs }),
      OPTIONS,
    ],
    'CCTP window': [
      definition({
        settlementLayers: ['CCTP'],
        validAfter: new Date(1_000_000_000_000),
        validUntil: VALID_UNTIL,
      }),
      OPTIONS,
    ],
  }
  const table: Record<string, unknown> = {}
  for (const [name, [def, options]] of Object.entries(sessions)) {
    table[name] = await pin(def, options)
  }
  expect(table).toMatchInlineSnapshot(`
    {
      "ACROSS fees one-shot": {
        "digest": "0x94eea744aa805f4a1fd252dbf0f972295e26d2f00f0ad035ccbe4038393adef8",
        "fingerprint": "0x63e6fd73b045ea36ea0ef154973e4138ddfefe76ffd4886685e74649e1ef0818",
        "permissionId": "0x6c20c1f7aad04b45340f900712e86431da58acad101fed458f10b6ce308a96e2",
      },
      "ACROSS two from tokens one-shot": {
        "digest": "0x943fd06df6d475ba525cb917bdb4b8d3705b351b018e341245465bbbdf55c4fb",
        "fingerprint": "0xad5d46a0cdb0bdaf1f280fcc8c509e52e594db311aeae6de991f29f416aacc82",
        "permissionId": "0xf952d3afaf09799558beb3d04a6df0a874e10374c74ea5f1cedb1e4dce67c90c",
      },
      "ACROSS two to legs": {
        "digest": "0x386a7e67e8c9c1a37af7761d2f235e823095549b2786eafae31c696cc50fe572",
        "fingerprint": "0xe8c1c66c4d6d32eacdc2ee6687ae779aaac4aa29b0f7db9f425c0ac594f2124d",
        "permissionId": "0x8b33ec8648bdef187bd0b64d94aa881250121bbdbb1f1441b170583f84176dfa",
      },
      "ACROSS wrapped native one-shot": {
        "digest": "0x1f87f09e0f53bd35422ff011800d952d1407635ce7d69ff2fe644d5b4b599933",
        "fingerprint": "0xd6a130649d0f400c083b0209af48b38ab320baf03ad63c1c5ebe2a2a79bce097",
        "permissionId": "0xcb410215b9c9f4593dbaf0a1b225c7d7ee15db4b25a05421ef75cc1e6552e213",
      },
      "CCTP fees": {
        "digest": "0x4edba52cc5983830bda1e8d1a639b843a909407cea4b036acbe1c76aed604532",
        "fingerprint": "0x2e8647bfa2c8ca4d3fc90a0f786988ca7fcd82add590422e2a46afa57f4c9225",
        "permissionId": "0xf4276880c8c9c670ecf8f57ab4b53c7404fe42bfd31049cc4f1efab99f6bf513",
      },
      "CCTP two to legs": {
        "digest": "0xc479afe868bd50b7e07fec151fdb7fde3ae94d86fe0c5ae06e373271c75bc401",
        "fingerprint": "0x08b517d75d1ae41300590bbcc8e7a0cc564bb65d98e55bd4e221a7cdfd7fe597",
        "permissionId": "0x1333f1961151abf259e2295db5c5fcea4637b71e903f60153a4f5bec8062aac7",
      },
      "CCTP window": {
        "digest": "0x4fd2ab39eb30ff8395d63e57d6a3f345f6294052cf2d5b172f7ac1d5438efed8",
        "fingerprint": "0x62634c5a204fe74c51b74f6159803dd846631f036c394a77430147fec924dbf8",
        "permissionId": "0x61dc14f39292eff238c51a6dde8b20e58ef8a19830513a1d9313d7dbaea93e87",
      },
    }
  `)
})

describe('the compiled approve', () => {
  const KINDS = {
    universalAction: [
      DEFAULT_POLICY_ADDRESSES.universalAction,
      ...UNIVERSAL_ACTION_POLICY_COPIES,
    ],
    argPolicy: DEFAULT_POLICY_ADDRESSES.argPolicy,
  }
  const installedApprove = (
    def: SessionDefinition,
    token: Address,
    options = OPTIONS,
  ) => {
    const approves = resolveSessionData(def, options).actions.filter(
      (a) =>
        isAddressEqual(a.actionTarget, token) &&
        a.actionTargetSelector === APPROVE,
    )
    expect(approves).toHaveLength(1)
    return install(approves[0].actionPolicies, KINDS)
  }

  test('holds one maxAmount across approve(Permit2) and the layers', () => {
    const installed = installedApprove(
      definition(capped({ settlementLayers: ['ACROSS', 'CCTP', 'LZ'] }), once),
      USDC,
    )
    expect(admits(installed, approve(PERMIT2, 60n))).toBe(true)
    expect(admits(installed, approve(MESSENGER, 41n))).toBe(false)
    expect(admits(installed, approve(DELEGATE, 40n))).toBe(true)
    expect(admits(installed, approve(PERMIT2, 1n))).toBe(false)
  })

  test('keeps the fee budget apart from maxAmount with allowFees', () => {
    const installed = installedApprove(
      definition(
        capped({ settlementLayers: ['ACROSS', 'CCTP'], allowFees: true }),
        once,
      ),
      USDC,
      FEE_OPTIONS,
    )
    expect(admits(installed, approve(PAYMASTER, 1_000_000n))).toBe(true)
    expect(admits(installed, approve(PERMIT2, 60n))).toBe(true)
    expect(admits(installed, approve(MESSENGER, 41n))).toBe(false)
    expect(admits(installed, approve(MESSENGER, 40n))).toBe(true)
    expect(admits(installed, approve(PERMIT2, 1n))).toBe(false)
  })

  test("caps each `from` token of an ACROSS-only 'all' session as the intent pin does", () => {
    const def = definition(
      {
        from: [
          { chain: base, token: USDC, maxAmount: 100n },
          { chain: base, token: OTHER },
        ],
        settlementLayers: 'all',
        fillDeadline: [{ chain: arbitrum, max: VALID_UNTIL }],
      },
      once,
    )
    expect(toSession(def, OPTIONS).permit2Sources).toEqual([
      { chain: base, token: USDC, maxAmount: 100n },
      { chain: base, token: OTHER, maxAmount: 100n },
    ])
    for (const token of [USDC, OTHER]) {
      const installed = installedApprove(def, token)
      expect(admits(installed, approve(PERMIT2, 101n))).toBe(false)
      expect(admits(installed, approve(PERMIT2, 100n))).toBe(true)
    }
  })
})

describe('the uncapped ACROSS route warning', () => {
  const warned = (def: SessionDefinition) =>
    (validateSessionDefinition(def, OPTIONS).warnings ?? []).map(
      ({ code }) => code,
    )

  test.each<[string, SessionDefinition]>([
    ['omitted layers without maxAmount', definition({})],
    ["'all' without maxAmount", definition({ settlementLayers: 'all' })],
    [
      'ACROSS named beside a layer without maxAmount',
      definition({ settlementLayers: ['ACROSS', 'CCTP'] }),
    ],
    [
      "'all' where another leg's cap leaves one token uncapped",
      definition(
        {
          from: [
            { chain: base, token: USDC },
            { chain: base, token: WETH, maxAmount: 10n ** 18n },
          ],
          settlementLayers: 'all',
        },
        once,
      ),
    ],
  ])('warns for %s', (_, def) => {
    expect(toSession(def, OPTIONS).settlementLayers).toContain('ACROSS')
    expect(validateSessionDefinition(def, OPTIONS).warnings).toEqual([
      expect.objectContaining({
        code: 'UNCAPPED_ACROSS_ROUTE',
        permitIndex: 0,
      }),
    ])
  })

  test.each<[string, SessionDefinition]>([
    ['a maxAmount on every leg', definition(capped({}), once)],
    [
      'ACROSS named beside a layer with maxAmount',
      definition(capped({ settlementLayers: ['ACROSS', 'CCTP'] }), once),
    ],
    [
      "'all' dropping ACROSS",
      definition({ settlementLayers: 'all' }, {}, avalanche),
    ],
    // As on main: a permit naming only ACROSS keeps the warnings it had.
    ['ACROSS named alone', definition({ settlementLayers: ['ACROSS'] })],
  ])('does not warn for %s', (_, def) => {
    expect(warned(def)).toEqual([])
  })
})
