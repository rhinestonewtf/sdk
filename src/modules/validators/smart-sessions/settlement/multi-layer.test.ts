import {
  type Address,
  type Chain,
  decodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  keccak256,
  maxUint256,
  toFunctionSelector,
  toHex,
} from 'viem'
import { arbitrum, base, plasma } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../../test/consts'
import {
  type RuleUsage,
  satisfiesRules,
} from '../../../../../test/utils/policy-rules'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { resolveCrossChainPermission } from '../cross-chain-permits'
import { encodeSessionPolicy } from '../policies/encode'
import { resolveSessionData, toSession } from '../resolve'
import type {
  CrossChainPermissionInput,
  ScopedAction,
  SessionDefinition,
} from '../types'
import { DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR } from './cctp'
import { PUBLISH_AND_FUND_SELECTOR } from './eco'
import { SETTLEMENT_FEE_CAP } from './fees'
import { LZ_EXECUTE_SELECTOR } from './lz'
import { resolveSettlementScope } from './scope'
import type { SettlementCatalog } from './types'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
const APPROVE = toFunctionSelector('approve(address,uint256)')
const OFT_ARB = SETTLEMENT_CATALOG[arbitrum.id].oft!
const OFT_PLASMA = SETTLEMENT_CATALOG[plasma.id].oft!
const BASE = SETTLEMENT_CATALOG[base.id]
const MESSENGER = BASE.cctp!.tokenMessenger
const DELEGATE = BASE.lz!.transferDelegate
const PORTAL = BASE.eco!.portal
const PAYMASTER = '0x6666666666666666666666666666666666666666' as Address
const FEES = {
  appFeeCollector: '0x5555555555555555555555555555555555555555',
  paymaster: PAYMASTER,
} as const
const WITH_FEES: SettlementCatalog = {
  ...SETTLEMENT_CATALOG,
  [base.id]: { ...BASE, fees: FEES },
  [arbitrum.id]: { ...SETTLEMENT_CATALOG[arbitrum.id], fees: FEES },
}
const VALID_UNTIL = new Date(2_000_000_000_000)

function definition(
  permit: Partial<CrossChainPermissionInput>,
  chain: Chain = base,
): SessionDefinition {
  return {
    chain,
    owners: { type: 'ecdsa', accounts: [accountA] },
    account: ACCOUNT,
    oneTimeUse: { id: 7n },
    policyAddresses: { oneTimeUseId: ONE_TIME_USE },
    crossChainPermits: [
      {
        from: { chain: base, token: USDC, maxAmount: 100n },
        to: { chain: arbitrum, token: USDC_ARB },
        ...permit,
      },
    ],
  } as SessionDefinition
}

const scope = (
  permit: Partial<CrossChainPermissionInput>,
  settlement: SettlementCatalog = SETTLEMENT_CATALOG,
  oneTimeUse = true,
) => {
  const input = definition(permit).crossChainPermits?.[0]
  const resolved = resolveSettlementScope(
    [resolveCrossChainPermission(input ?? {})],
    {
      chainId: base.id,
      environment: 'production',
      account: ACCOUNT,
      oneTimeUse,
      settlement,
    },
  )
  if (!resolved) throw new Error('expected a settlement scope')
  return resolved
}

const approveOf = (actions: readonly ScopedAction[]) => {
  const approves = actions.filter((a) => a.selector === APPROVE)
  expect(approves).toHaveLength(1)
  return approves[0]
}

const approve = (spender: Address, amount = 100n) =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  })

/** The ArgPolicy initData's rules and expression tree. */
function decodeArgPolicy(initData: Hex) {
  const [{ paramRules }] = decodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'valueLimitPerUse', type: 'uint256' },
          {
            name: 'paramRules',
            type: 'tuple',
            components: [
              { name: 'rootNodeIndex', type: 'uint8' },
              {
                name: 'rules',
                type: 'tuple[]',
                components: [
                  { name: 'condition', type: 'uint8' },
                  { name: 'offset', type: 'uint64' },
                  { name: 'isLimited', type: 'bool' },
                  { name: 'ref', type: 'bytes32' },
                  {
                    name: 'usage',
                    type: 'tuple',
                    components: [
                      { name: 'limit', type: 'uint256' },
                      { name: 'used', type: 'uint256' },
                    ],
                  },
                ],
              },
              { name: 'packedNodes', type: 'uint256[]' },
            ],
          },
        ],
      },
    ] as const,
    initData,
  )
  const node = (i: number) => {
    const packed = paramRules.packedNodes[i]
    return {
      kind: ['rule', 'not', 'and', 'or'][Number(packed & 3n)],
      rule: Number(packed >> 2n),
      left: Number((packed >> 10n) & 0xffn),
      right: Number((packed >> 18n) & 0xffn),
    }
  }
  return { rules: paramRules.rules, root: node(paramRules.rootNodeIndex), node }
}

/** Base serves an OFT of its own USDC, so OFT and LZ can both settle one permit. */
const USDC_OFT: SettlementCatalog = {
  ...SETTLEMENT_CATALOG,
  [base.id]: { ...BASE, oft: { adapter: OTHER, eid: 30184, token: USDC } },
  [arbitrum.id]: {
    ...SETTLEMENT_CATALOG[arbitrum.id],
    oft: { ...OFT_ARB, token: USDC_ARB },
  },
}

const digest = (def: SessionDefinition, settlement = SETTLEMENT_CATALOG) =>
  keccak256(
    toHex(
      JSON.stringify(resolveSessionData(def, { settlement }).actions, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    ),
  )

const SINGLE: Record<string, SessionDefinition> = {
  CCTP: definition({ settlementLayers: ['CCTP'] }),
  LZ: definition({ settlementLayers: ['LZ'] }),
  ECO_IE: definition({
    settlementLayers: ['ECO_IE'],
    maxFeeBps: 50,
    validUntil: VALID_UNTIL,
  }),
  OFT: definition(
    {
      from: { chain: arbitrum, token: OFT_ARB.token, maxAmount: 100n },
      to: { chain: plasma, token: OFT_PLASMA.token },
      settlementLayers: ['OFT'],
    },
    arbitrum,
  ),
  'CCTP with fees': definition({ settlementLayers: ['CCTP'], allowFees: true }),
}

describe('multi-layer settlement permits', () => {
  // Captured on main before multi-layer permits: a changed digest would be a
  // HashMismatch for every single-layer session already signed.
  test('a single-layer permit compiles to the same actions as before', () => {
    const digests = Object.fromEntries(
      Object.entries(SINGLE).map(([name, def]) => [
        name,
        digest(def, WITH_FEES),
      ]),
    )
    expect(digests).toMatchInlineSnapshot(`
      {
        "CCTP": "0xaf45f02832fa2ebc22ccc355dbb399c61417864ce82801debe85bd738c901fed",
        "CCTP with fees": "0xa6533b46c8986ff17e94fa85e88ed46a22a8436e3320971cc89b64d65534fe6c",
        "ECO_IE": "0x86893c3cfa9658848fe2643c944975e93e82b2e52798785c49ba553982360afb",
        "LZ": "0xd43889c3e9ec91179abefe75255724b8aba43f4661ffe361034eac3fd58ded1c",
        "OFT": "0x9ecc13fd247747c934cd2809805823031c43ed9b789f858cdaa0519b89ed0b43",
      }
    `)
  })

  test('two layers compile to both settlement calls and one approve', () => {
    const def = definition({ settlementLayers: ['CCTP', 'LZ'] })
    const data = resolveSessionData(def, { settlement: SETTLEMENT_CATALOG })
    expect(
      data.actions
        .slice(0, 3)
        .map((a) => [a.actionTarget, a.actionTargetSelector]),
    ).toEqual([
      [MESSENGER, DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR],
      [BASE.lz!.multiCall, LZ_EXECUTE_SELECTOR],
      [USDC, APPROVE],
    ])
    expect(
      toSession(def, { settlement: SETTLEMENT_CATALOG }).settlementLayers,
    ).toEqual(['CCTP', 'LZ'])
  })

  test('maxAmount bounds the total approved across the layers', () => {
    const action = approveOf(
      scope({ settlementLayers: ['CCTP', 'LZ'] }).actions,
    )
    expect(satisfiesRules(action, approve(MESSENGER))).toBe(true)
    expect(satisfiesRules(action, approve(DELEGATE))).toBe(true)
    expect(satisfiesRules(action, approve(DELEGATE, 101n))).toBe(false)
    const usage: RuleUsage = new Map()
    expect(satisfiesRules(action, approve(MESSENGER, 60n), usage)).toBe(true)
    expect(satisfiesRules(action, approve(DELEGATE, 60n), usage)).toBe(false)
    expect(satisfiesRules(action, approve(DELEGATE, 40n), usage)).toBe(true)
    expect(satisfiesRules(action, approve(MESSENGER, 1n), usage)).toBe(false)
  })

  test('the approve compiles to one cap counter, after the spender OR', () => {
    const [policy] =
      approveOf(scope({ settlementLayers: ['CCTP', 'LZ'] }).actions).policies ??
      []
    if (policy?.type !== 'arg-policy') throw new Error('expected an ArgPolicy')
    const { rules, root, node } = decodeArgPolicy(
      encodeSessionPolicy(policy, 'production').initData,
    )
    const limited = rules.filter((rule) => rule.isLimited)
    expect(limited).toHaveLength(1)
    expect(limited[0].offset).toBe(32n)
    expect(limited[0].usage.limit).toBe(100n)
    expect(root.kind).toBe('and')
    expect(node(root.left).kind).toBe('or')
    const cap = node(root.right)
    expect(cap.kind).toBe('rule')
    expect(rules[cap.rule].isLimited).toBe(true)
  })

  test('the order layers are named in does not change the session', () => {
    const resolve = (
      settlementLayers: CrossChainPermissionInput['settlementLayers'],
    ) =>
      resolveSessionData(definition({ settlementLayers }), {
        settlement: SETTLEMENT_CATALOG,
      })
    expect(resolve(['LZ', 'CCTP'])).toEqual(resolve(['CCTP', 'LZ']))
    expect(resolve(['CCTP', 'CCTP'])).toEqual(resolve(['CCTP']))
  })

  test('every action carries the once-policy, and the approve the time frame', () => {
    const def = definition({
      settlementLayers: ['CCTP', 'LZ'],
      validUntil: VALID_UNTIL,
    })
    const data = resolveSessionData(def, { settlement: SETTLEMENT_CATALOG })
    for (const action of data.actions.slice(0, 3)) {
      expect(action.actionPolicies.map((p) => p.policy)).toContain(ONE_TIME_USE)
    }
    const resolved = scope({
      settlementLayers: ['CCTP', 'LZ'],
      validUntil: VALID_UNTIL,
    })
    for (const action of resolved.actions) {
      expect(action.policies?.map((p) => p.type)).toContain('time-frame')
    }
  })

  test('refuses an approve to a layer the permit did not name', () => {
    const action = approveOf(
      scope({ settlementLayers: ['CCTP', 'LZ'] }).actions,
    )
    expect(satisfiesRules(action, approve(PORTAL))).toBe(false)
    // LZMultiCall runs whatever it is handed, so it must never hold an allowance.
    expect(satisfiesRules(action, approve(BASE.lz!.multiCall))).toBe(false)
    expect(satisfiesRules(action, approve(OTHER))).toBe(false)
  })

  test("'all' keeps the layers the permit can satisfy", () => {
    expect(scope({ settlementLayers: 'all' }).settlementLayers).toEqual([
      'CCTP',
      'LZ',
    ])
    const eco = scope({
      settlementLayers: 'all',
      maxFeeBps: 50,
      validUntil: VALID_UNTIL,
    })
    expect(eco.settlementLayers).toEqual(['CCTP', 'ECO_IE', 'LZ'])
    expect(eco.actions.map((a) => a.selector)).toEqual([
      DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR,
      PUBLISH_AND_FUND_SELECTOR,
      LZ_EXECUTE_SELECTOR,
      APPROVE,
    ])
    const action = approveOf(eco.actions)
    for (const spender of [MESSENGER, PORTAL, DELEGATE]) {
      expect(satisfiesRules(action, approve(spender))).toBe(true)
    }
  })

  test("the session's layers are the ones 'all' kept", () => {
    const session = toSession(definition({ settlementLayers: 'all' }), {
      settlement: SETTLEMENT_CATALOG,
    })
    expect(session.settlementLayers).toEqual(['CCTP', 'LZ'])
  })

  test("'all' without oneTimeUse or maxAmount keeps CCTP, uncapped", () => {
    const resolved = scope(
      { from: { chain: base, token: USDC }, settlementLayers: 'all' },
      SETTLEMENT_CATALOG,
      false,
    )
    expect(resolved.settlementLayers).toEqual(['CCTP'])
    const action = approveOf(resolved.actions)
    expect(satisfiesRules(action, approve(MESSENGER, maxUint256))).toBe(true)
    expect(satisfiesRules(action, approve(DELEGATE))).toBe(false)
  })

  test("'all' drops a layer only when it refuses the permit", () => {
    const { stablecoins: _, ...eco } = BASE.eco!
    const broken = {
      ...SETTLEMENT_CATALOG,
      [base.id]: { ...BASE, eco: eco as never },
    }
    expect(() =>
      scope(
        { settlementLayers: 'all', maxFeeBps: 50, validUntil: VALID_UNTIL },
        broken,
      ),
    ).toThrow(TypeError)
  })

  test('refuses OFT and LZ together: each pays a native fee', () => {
    expect(
      scope({ settlementLayers: ['OFT'] }, USDC_OFT).settlementLayers,
    ).toEqual(['OFT'])
    const message = 'OFT and LZ each pay a native LayerZero fee'
    expect(() => scope({ settlementLayers: ['OFT', 'LZ'] }, USDC_OFT)).toThrow(
      message,
    )
    expect(() => scope({ settlementLayers: 'all' }, USDC_OFT)).toThrow(message)
  })

  test("'all' refuses a permit no layer can satisfy, saying why", () => {
    const refusal = () =>
      scope({
        from: { chain: base, token: OTHER, maxAmount: 100n },
        settlementLayers: 'all',
      })
    expect(refusal).toThrow('no IntentExecutor layer can settle this permit')
    expect(refusal).toThrow('CCTP: CCTP moves only USDC')
    expect(refusal).not.toThrow('CCTP: crossChainPermits:')
    expect(refusal).toThrow('OFT does not route to chain 8453')
  })

  test.each([
    [
      'a layer that does not route from the chain',
      { settlementLayers: ['CCTP', 'OFT'] },
      'OFT does not route to chain 8453',
    ],
    [
      'a layer whose requirements the permit misses',
      { settlementLayers: ['CCTP', 'ECO_IE'] },
      'ECO_IE needs maxAmount and maxFeeBps',
    ],
    [
      'SAME_CHAIN_IE next to a bridge',
      { settlementLayers: ['SAME_CHAIN_IE', 'CCTP'] },
      'SAME_CHAIN_IE cannot share a permit with other IntentExecutor layers',
    ],
    [
      'maxFeeBps without ECO_IE',
      { settlementLayers: ['CCTP', 'LZ'], maxFeeBps: 50 },
      'maxFeeBps applies only to ECO_IE',
    ],
    [
      "maxFeeBps where 'all' drops ECO_IE",
      { settlementLayers: 'all', maxFeeBps: 50 },
      'maxFeeBps asks for ECO_IE, which cannot settle this permit: ECO_IE needs validUntil',
    ],
  ] as const)('refuses %s', (_, permit, message) => {
    expect(() => scope(permit as Partial<CrossChainPermissionInput>)).toThrow(
      message,
    )
  })

  test('allowFees joins the paymaster to the shared approve', () => {
    const action = approveOf(
      scope({ settlementLayers: ['CCTP', 'LZ'], allowFees: true }, WITH_FEES)
        .actions,
    )
    const usage: RuleUsage = new Map()
    // The fee budget is its own: a paymaster approve leaves the layers' cap whole.
    expect(
      satisfiesRules(action, approve(PAYMASTER, SETTLEMENT_FEE_CAP), usage),
    ).toBe(true)
    expect(satisfiesRules(action, approve(MESSENGER, 60n), usage)).toBe(true)
    expect(satisfiesRules(action, approve(DELEGATE, 40n), usage)).toBe(true)
    expect(satisfiesRules(action, approve(DELEGATE, 1n), usage)).toBe(false)
    expect(satisfiesRules(action, approve(PAYMASTER, 1n), usage)).toBe(false)
  })
})
