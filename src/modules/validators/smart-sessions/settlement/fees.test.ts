import {
  type Address,
  type Chain,
  decodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  maxUint256,
  pad,
  parseAbi,
  toFunctionSelector,
} from 'viem'
import { arbitrum, base, mainnet, plasma } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../../test/consts'
import { satisfiesRules } from '../../../../../test/utils/policy-rules'
import { sessionFingerprint } from '../../../../../test/utils/session-fingerprint'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { resolveCrossChainPermission } from '../cross-chain-permits'
import { encodeSessionPolicy } from '../policies/encode'
import { resolveSessionData, toSession } from '../resolve'
import { swapperAddresses } from '../swap/rhinestone'
import { allOf, pin } from '../swap/rules'
import type {
  CrossChainPermissionInput,
  FromLeg,
  Permission,
  ScopedAction,
  SessionDefinition,
} from '../types'
import {
  CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR,
  DEFAULT_SETTLEMENT_FEE_CAP,
  servedFees,
  settlementFeeCap,
  swapApprovesAsActions,
  withFeeActions,
} from './fees'
import { OFT_SEND_SELECTOR } from './oft'
import { resolveSettlementScope } from './scope'
import type { SettlementCatalog } from './types'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address
const WETH = '0x4200000000000000000000000000000000000006' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const RECIPIENT = '0x2222222222222222222222222222222222222222' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
const STRANGER = '0x4444444444444444444444444444444444444444' as Address
const COLLECTOR = '0x5555555555555555555555555555555555555555' as Address
const PAYMASTER = '0x6666666666666666666666666666666666666666' as Address
const TRANSFER = toFunctionSelector('transfer(address,uint256)')
const APPROVE = toFunctionSelector('approve(address,uint256)')
const CAP = DEFAULT_SETTLEMENT_FEE_CAP
const OFT_ARB = SETTLEMENT_CATALOG[arbitrum.id].oft!
const OFT_PLASMA = SETTLEMENT_CATALOG[plasma.id].oft!

const FEES = { appFeeCollector: COLLECTOR, paymaster: PAYMASTER }
const WITH_FEES: SettlementCatalog = {
  ...SETTLEMENT_CATALOG,
  [base.id]: { ...SETTLEMENT_CATALOG[base.id], fees: FEES },
  [arbitrum.id]: { ...SETTLEMENT_CATALOG[arbitrum.id], fees: FEES },
  [mainnet.id]: { ...SETTLEMENT_CATALOG[mainnet.id], fees: FEES },
}
const VALID_UNTIL = new Date(2_000_000_000_000)

const transfer = (to: Address, amount: bigint) =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amount],
  })
const approve = (spender: Address, amount: bigint) =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  })
const callback = (token: Address, amount: bigint) =>
  encodeFunctionData({
    abi: parseAbi([
      'function callbackAllowMaxAmount(address token, uint256 maxAmount)',
    ]),
    functionName: 'callbackAllowMaxAmount',
    args: [token, amount],
  })

/** Each run is a fresh session; calls within a run share its usage counters. */
function expectRuns(action: ScopedAction, runs: [Hex, boolean][][]) {
  for (const run of runs) {
    const usage = new Map()
    for (const [calldata, allowed] of run) {
      expect(satisfiesRules(action, calldata, usage)).toBe(allowed)
    }
  }
}

interface Layer {
  readonly chain: Chain
  readonly token: Address
  /** Who the layer's own approve names; undefined for the SAME_CHAIN_IE transfer. */
  readonly spender?: Address
  readonly permit: Partial<CrossChainPermissionInput>
}

const LAYERS: Record<string, Layer> = {
  CCTP: {
    chain: base,
    token: USDC,
    spender: SETTLEMENT_CATALOG[base.id].cctp!.tokenMessenger,
    permit: { settlementLayers: ['CCTP'] },
  },
  OFT: {
    chain: arbitrum,
    token: OFT_ARB.token,
    spender: OFT_ARB.adapter,
    permit: {
      settlementLayers: ['OFT'],
      to: { chain: plasma, token: OFT_PLASMA.token },
    },
  },
  LZ: {
    chain: base,
    token: USDC,
    spender: SETTLEMENT_CATALOG[base.id].lz!.transferDelegate,
    permit: { settlementLayers: ['LZ'] },
  },
  ECO_IE: {
    chain: base,
    token: USDC,
    spender: SETTLEMENT_CATALOG[base.id].eco!.portal,
    permit: { settlementLayers: ['ECO_IE'], maxFeeBps: 50 },
  },
  'SAME_CHAIN_IE transfer': {
    chain: base,
    token: USDC,
    permit: {
      settlementLayers: ['SAME_CHAIN_IE'],
      to: { chain: base, token: USDC, recipient: RECIPIENT },
      allowRecipientNotAccount: true,
    },
  },
  'SAME_CHAIN_IE swap': {
    chain: base,
    token: USDC,
    spender: swapperAddresses('production').proxy,
    permit: {
      settlementLayers: ['SAME_CHAIN_IE'],
      to: { chain: base, token: WETH, recipient: RECIPIENT, minAmount: 5n },
      allowRecipientNotAccount: true,
    },
  },
}

const permit = (
  layer: Layer,
  extra: Partial<CrossChainPermissionInput> = {},
): CrossChainPermissionInput => ({
  from: { chain: layer.chain, token: layer.token, maxAmount: 100n },
  to: { chain: arbitrum, token: USDC_ARB },
  validUntil: VALID_UNTIL,
  ...layer.permit,
  ...extra,
})

const scope = (
  input: CrossChainPermissionInput,
  settlement: SettlementCatalog | null = WITH_FEES,
) => {
  const resolved = resolveSettlementScope(
    [resolveCrossChainPermission(input)],
    {
      chainId: (input.from as FromLeg).chain.id,
      environment: 'production',
      account: ACCOUNT,
      oneTimeUse: true,
      ...(settlement ? { settlement } : {}),
    },
  )
  if (!resolved) throw new Error('expected a settlement scope')
  return resolved
}

const definition = (input: CrossChainPermissionInput): SessionDefinition => ({
  chain: (input.from as FromLeg).chain,
  owners: { type: 'ecdsa', accounts: [accountA] },
  account: ACCOUNT,
  crossChainPermits: [input],
  oneTimeUse: { id: 7n },
  policyAddresses: { oneTimeUseId: ONE_TIME_USE },
})

const find = (actions: readonly ScopedAction[], target: Address, sel: Hex) => {
  const action = actions.find(
    (a) =>
      a.target.toLowerCase() === target.toLowerCase() && a.selector === sel,
  )
  if (!action) throw new Error(`no ${sel} action on ${target}`)
  return action
}

const sharesAFeeCall = (a: ScopedAction, token: Address) =>
  a.target.toLowerCase() === token.toLowerCase() &&
  (a.selector === APPROVE || a.selector === TRANSFER)

describe.each(Object.entries(LAYERS))('allowFees on %s', (_, layer) => {
  const on = () => scope(permit(layer, { allowFees: true })).actions
  const { token } = layer

  test('off leaves the session exactly as before', () => {
    const before = scope(permit(layer), SETTLEMENT_CATALOG)
    expect(scope(permit(layer, { allowFees: false }))).toEqual(before)
    expect(scope(permit(layer))).toEqual(before)
    expect(
      toSession(definition(permit(layer, { allowFees: false })), {
        settlement: WITH_FEES,
      }),
    ).toEqual(
      toSession(definition(permit(layer)), { settlement: SETTLEMENT_CATALOG }),
    )
  })

  test('the fee transfer names only the collector, 5 USD cumulative', () => {
    expectRuns(find(on(), token, TRANSFER), [
      [[transfer(COLLECTOR, CAP), true]],
      [[transfer(COLLECTOR, CAP + 1n), false]],
      [[transfer(STRANGER, 1n), false]],
      [
        [transfer(COLLECTOR, 3_000_000n), true],
        [transfer(COLLECTOR, 3_000_000n), false],
        [transfer(COLLECTOR, 2_000_000n), true],
      ],
    ])
  })

  test('the paymaster approve, reset included, 5 USD cumulative', () => {
    expectRuns(find(on(), token, APPROVE), [
      [
        [approve(PAYMASTER, 0n), true],
        [approve(PAYMASTER, CAP), true],
        [approve(PAYMASTER, 1n), false],
      ],
      [[approve(PAYMASTER, CAP + 1n), false]],
      [[approve(STRANGER, 1n), false]],
    ])
  })

  test('the paymaster callback names only the token, 5 USD cumulative', () => {
    const action = find(on(), PAYMASTER, CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR)
    expect(action.policies).toContainEqual(
      expect.objectContaining({
        type: 'universal-action',
        valueLimitPerUse: 0n,
      }),
    )
    expectRuns(action, [
      [[callback(token, CAP), true]],
      [[callback(token, CAP + 1n), false]],
      [[callback(WETH, 1n), false]],
      [
        [callback(token, 3_000_000n), true],
        [callback(token, 3_000_000n), false],
      ],
    ])
  })

  test('calls the fees do not share are untouched', () => {
    const fees = on()
    const off = scope(permit(layer)).actions
    for (const action of off) {
      if (sharesAFeeCall(action, token)) {
        find(fees, action.target, action.selector)
      } else {
        expect(find(fees, action.target, action.selector)).toEqual(action)
      }
    }
  })

  test('each action keeps one params policy', () => {
    for (const action of on()) {
      const params = (action.policies ?? []).filter(
        (p) => p.type === 'universal-action' || p.type === 'arg-policy',
      )
      expect(params).toHaveLength(1)
    }
  })

  test('the once-policy carries validUntil, with no time frame', () => {
    for (const action of on()) {
      expect(action.policies?.map((p) => p.type)).not.toContain('time-frame')
    }
    const data = resolveSessionData(
      definition(permit(layer, { allowFees: true })),
      { settlement: WITH_FEES },
    )
    for (const action of data.actions) {
      const once = action.actionPolicies.find(
        (p) => p.policy.toLowerCase() === ONE_TIME_USE.toLowerCase(),
      )
      expect(once).toBeDefined()
      const [, deadline] = decodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256' }],
        once!.initData,
      )
      expect(deadline).toBe(BigInt(VALID_UNTIL.getTime() / 1000))
    }
  })

  test('resolves with the once-policy on every action and no policy twice', () => {
    const data = resolveSessionData(
      definition(permit(layer, { allowFees: true })),
      { settlement: WITH_FEES },
    )
    const targets = data.actions.map((a) => [
      a.actionTarget.toLowerCase(),
      a.actionTargetSelector,
    ])
    expect(targets).toContainEqual([token.toLowerCase(), TRANSFER])
    expect(targets).toContainEqual([token.toLowerCase(), APPROVE])
    expect(targets).toContainEqual([
      PAYMASTER.toLowerCase(),
      CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR,
    ])
    for (const action of data.actions) {
      const policies = action.actionPolicies.map((p) => p.policy.toLowerCase())
      expect(new Set(policies).size).toBe(policies.length)
      expect(policies).toContain(ONE_TIME_USE.toLowerCase())
    }
  })
})

const withSpender = Object.entries(LAYERS).filter(
  (entry): entry is [string, Layer & { spender: Address }] =>
    entry[1].spender !== undefined,
)

describe('allowFees merges into the layer call it shares', () => {
  test.each(withSpender)('%s approve keeps its spender and cap', (_, layer) => {
    const { spender } = layer
    expectRuns(
      find(
        scope(permit(layer, { allowFees: true })).actions,
        layer.token,
        APPROVE,
      ),
      [
        [[approve(spender, 100n), true]],
        [[approve(spender, 101n), false]],
        [[approve(spender, CAP), false]],
        // The fee approve neither draws from nor is drawn from by the layer's cap.
        [
          [approve(PAYMASTER, CAP), true],
          [approve(spender, 60n), true],
          [approve(spender, 60n), false],
          [approve(spender, 40n), true],
          [approve(PAYMASTER, 1n), false],
        ],
      ],
    )
  })

  test('SAME_CHAIN_IE transfer keeps its recipient and cap', () => {
    expectRuns(
      find(
        scope(permit(LAYERS['SAME_CHAIN_IE transfer'], { allowFees: true }))
          .actions,
        USDC,
        TRANSFER,
      ),
      [
        [
          [transfer(COLLECTOR, CAP), true],
          [transfer(RECIPIENT, 100n), true],
          [transfer(RECIPIENT, 1n), false],
          [transfer(COLLECTOR, 1n), false],
        ],
        [[transfer(RECIPIENT, 101n), false]],
        [[transfer(STRANGER, 100n), false]],
      ],
    )
  })

  test('the OFT send keeps its native fee allowance', () => {
    const send = find(
      scope(permit(LAYERS.OFT, { allowFees: true })).actions,
      OFT_ARB.adapter,
      OFT_SEND_SELECTOR,
    )
    expect(send.policies).toContainEqual(
      expect.objectContaining({ valueLimitPerUse: maxUint256 }),
    )
  })

  test('SAME_CHAIN_IE swap approve drops the shared spending limit for a raw action', () => {
    const input = permit(LAYERS['SAME_CHAIN_IE swap'])
    const off = scope(input)
    expect(off.permissions).toHaveLength(1)
    const on = scope({ ...input, allowFees: true })
    expect(on.permissions).toEqual([])
    const action = find(on.actions, USDC, APPROVE)
    expect(action.policies?.map((p) => p.type)).not.toContain('spending-limits')
  })

  // ArgPolicy short-circuits left to right; the fee branch must come first so a
  // layer call never reaches its limited rule, and a fee call never the layer's.
  test.each([
    ['CCTP approve', LAYERS.CCTP, APPROVE, PAYMASTER, LAYERS.CCTP.spender!],
    ['OFT approve', LAYERS.OFT, APPROVE, PAYMASTER, LAYERS.OFT.spender!],
    [
      'SAME_CHAIN_IE transfer',
      LAYERS['SAME_CHAIN_IE transfer'],
      TRANSFER,
      COLLECTOR,
      RECIPIENT,
    ],
  ] as const)(
    'the encoded %s puts the fee branch left of the layer branch',
    (_, layer, selector, feePin, layerPin) => {
      const action = find(
        scope(permit(layer, { allowFees: true })).actions,
        layer.token,
        selector,
      )
      const policy = action.policies?.find((p) => p.type === 'arg-policy')
      if (!policy) throw new Error('no arg-policy')
      const { paramRules } = decodeArgPolicy(
        encodeSessionPolicy(policy, 'production').initData,
      )
      const node = (index: number) => {
        const packed = paramRules.packedNodes[index]
        return {
          type: Number(packed & 3n),
          rule: Number((packed >> 2n) & 0xffn),
          left: Number((packed >> 10n) & 0xffn),
          right: Number((packed >> 18n) & 0xffn),
        }
      }
      const refs = (index: number): Hex[] => {
        const n = node(index)
        if (n.type === 0) return [paramRules.rules[n.rule].ref]
        if (n.type === 1) return refs(n.left)
        return [...refs(n.left), ...refs(n.right)]
      }
      const root = node(paramRules.rootNodeIndex)
      expect(root.type).toBe(3) // OR
      const fee = node(root.left)
      expect(fee.type).toBe(2) // AND(pin, cap)
      const [pinNode, capNode] = [node(fee.left), node(fee.right)]
      expect(paramRules.rules[pinNode.rule]).toMatchObject({
        ref: pad(feePin).toLowerCase(),
        isLimited: false,
      })
      expect(paramRules.rules[capNode.rule]).toMatchObject({
        isLimited: true,
        usage: { limit: CAP, used: 0n },
      })
      expect(refs(root.right)).toContain(pad(layerPin).toLowerCase())
      expect(refs(root.right)).not.toContain(pad(feePin).toLowerCase())
    },
  )
})

test('without a validity window the fee calls carry no time-frame', () => {
  const actions = scope(
    permit(LAYERS.CCTP, { allowFees: true, validUntil: undefined }),
  ).actions
  for (const action of actions) {
    expect(action.policies?.map((p) => p.type)).not.toContain('time-frame')
  }
  expectRuns(find(actions, USDC, TRANSFER), [
    [[transfer(COLLECTOR, CAP), true]],
    [[transfer(STRANGER, 1n), false]],
  ])
})

describe('allowFees refuses', () => {
  test('a `from` token that is not a served USD stablecoin', () => {
    expect(() =>
      scope(
        permit(LAYERS['SAME_CHAIN_IE transfer'], {
          from: { chain: base, token: WETH, maxAmount: 100n },
          to: { chain: base, token: WETH, recipient: RECIPIENT },
          allowFees: true,
        }),
      ),
    ).toThrow('must be a served USD stablecoin')
  })

  test('every layer on a chain with no fees block', () => {
    for (const layer of Object.values(LAYERS)) {
      expect(() =>
        scope(permit(layer, { allowFees: true }), SETTLEMENT_CATALOG),
      ).toThrow(`serves no fee addresses on chain ${layer.chain.id}`)
    }
  })

  test('a SAME_CHAIN_IE permit without served settlement addresses', () => {
    const input = permit(LAYERS['SAME_CHAIN_IE transfer'])
    expect(() => scope(input, null)).not.toThrow()
    expect(() => scope({ ...input, allowFees: true }, null)).toThrow(
      'create the session with sdk.createSession',
    )
  })

  test('a Permit2-layer permit', () => {
    expect(() =>
      resolveSessionData({
        chain: base,
        owners: { type: 'ecdsa', accounts: [accountA] },
        crossChainPermits: [
          {
            from: { chain: base, token: USDC },
            to: { chain: arbitrum, token: USDC_ARB },
            settlementLayers: ['ACROSS'],
            allowFees: true,
          },
        ],
      }),
    ).toThrow('allowFees applies only to IntentExecutor layers')
  })
})

test('the paymaster callback pins any of several `from` tokens, one shared budget', () => {
  const [action] = withFeeActions([], [USDC, USDC_ARB], FEES, base.id).filter(
    (a) => a.selector === CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR,
  )
  expectRuns(action, [
    [[callback(USDC, 1n), true]],
    [[callback(USDC_ARB, 1n), true]],
    [[callback(WETH, 1n), false]],
    [
      [callback(USDC, 3_000_000n), true],
      [callback(USDC_ARB, 3_000_000n), false],
    ],
  ])
})

test('refuses to join an action with no params policy', () => {
  expect(() =>
    withFeeActions(
      [{ target: USDC, selector: APPROVE }],
      [USDC],
      FEES,
      base.id,
    ),
  ).toThrow('has no params policy for allowFees to join')
})

test('joins the params policy and keeps the other policies on the action', () => {
  const usageLimit = { type: 'usage-limit', limit: 3n } as const
  const joined = withFeeActions(
    [
      {
        target: USDC,
        selector: APPROVE,
        policies: [
          { type: 'arg-policy', expression: allOf([pin(0n, STRANGER)]) },
          usageLimit,
        ],
      },
    ],
    [USDC],
    FEES,
    base.id,
  )
  const action = find(joined, USDC, APPROVE)
  expect(action.policies).toHaveLength(2)
  expect(action.policies).toContainEqual(usageLimit)
  expect(action.policies?.[0]).toMatchObject({
    type: 'arg-policy',
    valueLimitPerUse: 0n,
  })
  expectRuns(action, [
    [[approve(PAYMASTER, CAP), true]],
    [[approve(STRANGER, maxUint256), true]],
    [[approve(COLLECTOR, 1n), false]],
  ])
})

describe('swapApprovesAsActions refuses', () => {
  const approvePermission = (params?: object) =>
    ({
      abi: erc20Abi,
      address: USDC,
      functions: {
        approve: {
          spendingLimit: { token: USDC, amount: 100n },
          ...(params ? { params } : {}),
        },
      },
    }) as unknown as Permission

  test('a permission that is not an approve', () => {
    expect(() =>
      swapApprovesAsActions(
        [
          {
            abi: erc20Abi,
            address: USDC,
            functions: {
              transfer: { params: { recipient: { value: RECIPIENT } } },
            },
          } as unknown as Permission,
        ],
        100n,
      ),
    ).toThrow('expected only approve permissions')
  })

  test('an approve with no params policy to carry the cap', () => {
    expect(() => swapApprovesAsActions([approvePermission()], 100n)).toThrow(
      'no params policy to carry its cap',
    )
  })

  test('an uncapped swap', () => {
    const permission = approvePermission({
      spender: { condition: 'equal', value: STRANGER },
    })
    expect(() => swapApprovesAsActions([permission], undefined)).toThrow(
      'needs maxAmount',
    )
    expect(swapApprovesAsActions([], undefined)).toEqual([])
  })
})

test('a swap approve trades its spending limit for the cap and keeps maxUses', () => {
  const [action] = swapApprovesAsActions(
    [
      {
        abi: erc20Abi,
        address: USDC,
        functions: {
          approve: {
            spendingLimit: { token: USDC, amount: 100n },
            maxUses: 2n,
            params: { spender: { condition: 'equal', value: STRANGER } },
          },
        },
      } as unknown as Permission,
    ],
    100n,
  )
  expect(action.policies?.map((p) => p.type)).not.toContain('spending-limits')
  expect(action.policies).toContainEqual({ type: 'usage-limit', limit: 2n })
  expectRuns(action, [
    [[approve(STRANGER, 100n), true]],
    [
      [approve(STRANGER, 60n), true],
      [approve(STRANGER, 60n), false],
    ],
    [[approve(COLLECTOR, 1n), false]],
  ])
})

const usd = (address: Address, decimals = 6) => ({
  address,
  symbol: 'USD',
  decimals,
})

test('a token served by any one layer counts as a stablecoin', () => {
  const USDT0 = OFT_ARB.token
  const settlement = {
    1: { oft: { adapter: STRANGER, eid: 1, token: USDT0 }, fees: FEES },
  }
  expect(servedFees(settlement, 1, [USDT0])).toEqual(FEES)
  expect(() => servedFees(settlement, 1, [USDC])).toThrow(
    'must be a served USD stablecoin',
  )
})

describe('a fee token usdStablecoins lists must be 6-decimal', () => {
  const USDT0 = OFT_ARB.token
  const served = (usdStablecoins?: ReturnType<typeof usd>[]) => ({
    1: {
      oft: { adapter: STRANGER, eid: 1, token: USDT0 },
      fees: FEES,
      ...(usdStablecoins ? { usdStablecoins } : {}),
    },
  })

  test.each([
    ['no usdStablecoins', served()],
    ['no entry for the token', served([usd(USDC, 2)])],
    ['a 6-decimal entry', served([usd(USDT0)])],
    [
      'a 6-decimal entry, any case',
      served([usd(USDT0.toLowerCase() as Address)]),
    ],
  ])('accepts %s', (_, settlement) => {
    expect(servedFees(settlement, 1, [USDT0])).toEqual(FEES)
  })

  test.each([
    ['2 decimals, which would scale the cap up 10^4', served([usd(USDT0, 2)])],
    ['18 decimals', served([usd(USDT0, 18)])],
    ['2 decimals, any case', served([usd(USDT0.toLowerCase() as Address, 2)])],
  ])('refuses %s', (_, settlement) => {
    expect(() => servedFees(settlement, 1, [USDT0])).toThrow(
      expect.objectContaining({ code: 'ALLOW_FEES_NON_STABLECOIN' }),
    )
  })

  const onBase = (usdStablecoins?: ReturnType<typeof usd>[]) => {
    const { usdStablecoins: _, ...rest } = WITH_FEES[base.id]
    return {
      ...WITH_FEES,
      [base.id]: { ...rest, ...(usdStablecoins ? { usdStablecoins } : {}) },
    }
  }

  test('a CCTP session on a chain with no usdStablecoins scopes as on main', () => {
    expect(scope(permit(LAYERS.CCTP, { allowFees: true }), onBase())).toEqual(
      scope(permit(LAYERS.CCTP, { allowFees: true })),
    )
  })

  test('a CCTP session refuses a USDC served with 2 decimals', () => {
    expect(() =>
      scope(permit(LAYERS.CCTP, { allowFees: true }), onBase([usd(USDC, 2)])),
    ).toThrow('is served with 2 decimals')
  })
})

describe('the fee cap by chain', () => {
  const ON_ETHEREUM: Layer = {
    ...LAYERS.CCTP,
    chain: mainnet,
    token: SETTLEMENT_CATALOG[mainnet.id].cctp!.usdc,
    spender: SETTLEMENT_CATALOG[mainnet.id].cctp!.tokenMessenger,
  }
  const fingerprint = (layer: Layer) =>
    sessionFingerprint(
      toSession(definition(permit(layer, { allowFees: true })), {
        settlement: WITH_FEES,
      }),
    )

  test.each([
    ['Ethereum', 30, ON_ETHEREUM],
    ['Base', 5, LAYERS.CCTP],
    ['Arbitrum', 5, LAYERS.OFT],
  ] as const)('each fee call on %s caps at %s USD', (_, usd, layer) => {
    const cap = BigInt(usd) * 1_000_000n
    expect(settlementFeeCap(layer.chain.id)).toBe(cap)
    const actions = scope(permit(layer, { allowFees: true })).actions
    const calls = [
      [layer.token, TRANSFER, (n: bigint) => transfer(COLLECTOR, n)],
      [layer.token, APPROVE, (n: bigint) => approve(PAYMASTER, n)],
      [
        PAYMASTER,
        CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR,
        (n: bigint) => callback(layer.token, n),
      ],
    ] as const
    for (const [target, selector, call] of calls) {
      expectRuns(find(actions, target, selector), [
        [[call(cap), true]],
        [[call(cap + 1n), false]],
      ])
    }
  })

  test('the Ethereum cap is cumulative', () => {
    const actions = scope(permit(ON_ETHEREUM, { allowFees: true })).actions
    const token = ON_ETHEREUM.token
    expectRuns(find(actions, token, TRANSFER), [
      [
        [transfer(COLLECTOR, 20_000_000n), true],
        [transfer(COLLECTOR, 11_000_000n), false],
        [transfer(COLLECTOR, 10_000_000n), true],
      ],
    ])
    expectRuns(find(actions, PAYMASTER, CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR), [
      [
        [callback(token, 20_000_000n), true],
        [callback(token, 11_000_000n), false],
      ],
    ])
  })

  test('sessions off Ethereum keep the fingerprints taken before the change', () => {
    expect(
      Object.fromEntries(
        Object.entries(LAYERS).map(([name, layer]) => [
          name,
          fingerprint(layer),
        ]),
      ),
    ).toEqual({
      CCTP: '0xf52a8746263b839bbd3ac2275afa56ae0504a15e09ab6f4169a8788b947b1ae3',
      ECO_IE:
        '0x73d704fb24ace41950d624beefc001fc9bc9bcbee80b801638acc292c121e438',
      LZ: '0x7268b8d6485c266fee6eedc4987a5b588d5c255206b954bbb5fb704a53d4bb75',
      OFT: '0x49e5202053dc24727cad3976ab0db8650edcac8e558c24801015d82afc77d8ea',
      'SAME_CHAIN_IE swap':
        '0x365b4366c4795086fe83b43de7e91a7b947f31ebc55c56ea973092935e35ad66',
      'SAME_CHAIN_IE transfer':
        '0xade8ace201214a669aedc5d05f46a3f9895d846a86472346e880a5c94a49165f',
    })
  })

  test('a session on Ethereum no longer matches the one taken before', () => {
    expect(fingerprint(ON_ETHEREUM)).not.toBe(
      '0x44849fcb3a6b0393ffcb3b16b03b2763dc8d43d5edfbd808f027093c24132400',
    )
  })
})

const argPolicyAbi = [
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
] as const

function decodeArgPolicy(initData: Hex) {
  return decodeAbiParameters(argPolicyAbi, initData)[0]
}
