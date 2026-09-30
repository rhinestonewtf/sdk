import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  parseAbi,
  toFunctionSelector,
} from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../../test/consts'
import {
  type RuleUsage,
  satisfiesRules,
} from '../../../../../test/utils/policy-rules'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { resolveCrossChainPermission } from '../cross-chain-permits'
import { resolveSessionData, toSession } from '../resolve'
import type {
  CrossChainPermissionInput,
  Permission,
  ScopedAction,
  SessionDefinition,
} from '../types'
import {
  CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR,
  permissionsAsActions,
  SETTLEMENT_FEE_CAP,
  servedFees,
  withFeeActions,
} from './fees'
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
const CAP = SETTLEMENT_FEE_CAP

const FEES = { appFeeCollector: COLLECTOR, paymaster: PAYMASTER }
const WITH_FEES: SettlementCatalog = {
  ...SETTLEMENT_CATALOG,
  [base.id]: { ...SETTLEMENT_CATALOG[base.id], fees: FEES },
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

const LAYERS: Record<string, Partial<CrossChainPermissionInput>> = {
  CCTP: { settlementLayers: ['CCTP'] },
  LZ: { settlementLayers: ['LZ'] },
  ECO_IE: { settlementLayers: ['ECO_IE'], maxFeeBps: 50 },
  'SAME_CHAIN_IE transfer': {
    settlementLayers: ['SAME_CHAIN_IE'],
    to: { chain: base, token: USDC, recipient: RECIPIENT },
    allowRecipientNotAccount: true,
  },
  'SAME_CHAIN_IE swap': {
    settlementLayers: ['SAME_CHAIN_IE'],
    to: { chain: base, token: WETH, recipient: RECIPIENT, minAmount: 5n },
    allowRecipientNotAccount: true,
  },
}

const permit = (
  extra: Partial<CrossChainPermissionInput>,
): CrossChainPermissionInput => ({
  from: { chain: base, token: USDC, maxAmount: 100n },
  to: { chain: arbitrum, token: USDC_ARB },
  validUntil: VALID_UNTIL,
  ...extra,
})

const scope = (
  input: CrossChainPermissionInput,
  settlement: SettlementCatalog | null = WITH_FEES,
) => {
  const resolved = resolveSettlementScope(
    [resolveCrossChainPermission(input)],
    {
      chainId: base.id,
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
  chain: base,
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

describe.each(Object.entries(LAYERS))('allowFees on %s', (_, layer) => {
  const on = () => scope(permit({ ...layer, allowFees: true })).actions

  test('off leaves the session exactly as before', () => {
    const before = scope(permit(layer), SETTLEMENT_CATALOG)
    expect(scope(permit({ ...layer, allowFees: false }))).toEqual(before)
    expect(scope(permit(layer))).toEqual(before)
    expect(
      toSession(definition(permit({ ...layer, allowFees: false })), {
        settlement: WITH_FEES,
      }),
    ).toEqual(
      toSession(definition(permit(layer)), { settlement: SETTLEMENT_CATALOG }),
    )
  })

  test('admits the fee transfer to the collector, capped cumulatively', () => {
    const action = find(on(), USDC, TRANSFER)
    expect(satisfiesRules(action, transfer(COLLECTOR, CAP), new Map())).toBe(
      true,
    )
    expect(
      satisfiesRules(action, transfer(COLLECTOR, CAP + 1n), new Map()),
    ).toBe(false)
    expect(satisfiesRules(action, transfer(STRANGER, 1n), new Map())).toBe(
      false,
    )
    const usage: RuleUsage = new Map()
    expect(satisfiesRules(action, transfer(COLLECTOR, 3_000_000n), usage)).toBe(
      true,
    )
    expect(satisfiesRules(action, transfer(COLLECTOR, 3_000_000n), usage)).toBe(
      false,
    )
    expect(satisfiesRules(action, transfer(COLLECTOR, 2_000_000n), usage)).toBe(
      true,
    )
  })

  test('admits the paymaster approve, reset included, capped cumulatively', () => {
    const action = find(on(), USDC, APPROVE)
    const usage: RuleUsage = new Map()
    expect(satisfiesRules(action, approve(PAYMASTER, 0n), usage)).toBe(true)
    expect(satisfiesRules(action, approve(PAYMASTER, CAP), usage)).toBe(true)
    expect(satisfiesRules(action, approve(PAYMASTER, 1n), usage)).toBe(false)
    expect(
      satisfiesRules(action, approve(PAYMASTER, CAP + 1n), new Map()),
    ).toBe(false)
    expect(satisfiesRules(action, approve(STRANGER, 1n), new Map())).toBe(false)
  })

  test('admits the paymaster callback for the token, capped cumulatively', () => {
    const action = find(on(), PAYMASTER, CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR)
    expect(action.policies).toContainEqual(
      expect.objectContaining({ type: 'arg-policy', valueLimitPerUse: 0n }),
    )
    expect(satisfiesRules(action, callback(USDC, CAP), new Map())).toBe(true)
    expect(satisfiesRules(action, callback(USDC, CAP + 1n), new Map())).toBe(
      false,
    )
    expect(satisfiesRules(action, callback(WETH, 1n), new Map())).toBe(false)
    const usage: RuleUsage = new Map()
    expect(satisfiesRules(action, callback(USDC, 3_000_000n), usage)).toBe(true)
    expect(satisfiesRules(action, callback(USDC, 3_000_000n), usage)).toBe(
      false,
    )
  })

  test('each action keeps one params policy and the window', () => {
    const fees = on()
    const off = scope(permit(layer)).actions
    for (const action of fees) {
      const params = (action.policies ?? []).filter(
        (p) => p.type === 'universal-action' || p.type === 'arg-policy',
      )
      expect(params).toHaveLength(1)
      expect(action.policies).toContainEqual({
        type: 'time-frame',
        validAfter: 0,
        validUntil: VALID_UNTIL.getTime(),
      })
    }
    // Every layer action is still there; only the fee calls are new.
    for (const action of off) find(fees, action.target, action.selector)
  })

  test('resolves with the once-policy on every action and no policy twice', () => {
    const data = resolveSessionData(
      definition(permit({ ...layer, allowFees: true })),
      { settlement: WITH_FEES },
    )
    const targets = data.actions.map((a) => [
      a.actionTarget.toLowerCase(),
      a.actionTargetSelector,
    ])
    expect(targets).toContainEqual([USDC.toLowerCase(), TRANSFER])
    expect(targets).toContainEqual([USDC.toLowerCase(), APPROVE])
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

describe('allowFees merges into the layer call it shares', () => {
  const layerApproves: [string, Address][] = [
    ['CCTP', SETTLEMENT_CATALOG[base.id].cctp!.tokenMessenger],
    ['LZ', SETTLEMENT_CATALOG[base.id].lz!.transferDelegate],
    ['ECO_IE', SETTLEMENT_CATALOG[base.id].eco!.portal],
  ]
  test.each(layerApproves)(
    '%s approve keeps its spender and cap',
    (name, spender) => {
      const action = find(
        scope(permit({ ...LAYERS[name], allowFees: true })).actions,
        USDC,
        APPROVE,
      )
      expect(satisfiesRules(action, approve(spender, 100n), new Map())).toBe(
        true,
      )
      expect(satisfiesRules(action, approve(spender, 101n), new Map())).toBe(
        false,
      )
      const usage: RuleUsage = new Map()
      // The fee approve neither draws from nor is drawn from by the layer's cap.
      expect(satisfiesRules(action, approve(PAYMASTER, CAP), usage)).toBe(true)
      expect(satisfiesRules(action, approve(spender, 60n), usage)).toBe(true)
      expect(satisfiesRules(action, approve(spender, 60n), usage)).toBe(false)
      expect(satisfiesRules(action, approve(spender, 40n), usage)).toBe(true)
      expect(satisfiesRules(action, approve(PAYMASTER, 1n), usage)).toBe(false)
      expect(satisfiesRules(action, approve(spender, CAP), new Map())).toBe(
        false,
      )
    },
  )

  test('SAME_CHAIN_IE transfer keeps its recipient and cap', () => {
    const action = find(
      scope(permit({ ...LAYERS['SAME_CHAIN_IE transfer'], allowFees: true }))
        .actions,
      USDC,
      TRANSFER,
    )
    const usage: RuleUsage = new Map()
    expect(satisfiesRules(action, transfer(COLLECTOR, CAP), usage)).toBe(true)
    expect(satisfiesRules(action, transfer(RECIPIENT, 100n), usage)).toBe(true)
    expect(satisfiesRules(action, transfer(RECIPIENT, 1n), usage)).toBe(false)
    expect(satisfiesRules(action, transfer(COLLECTOR, 1n), usage)).toBe(false)
    expect(satisfiesRules(action, transfer(RECIPIENT, 101n), new Map())).toBe(
      false,
    )
    expect(satisfiesRules(action, transfer(STRANGER, 100n), new Map())).toBe(
      false,
    )
  })

  test('SAME_CHAIN_IE swap approve keeps its spender and cap without the shared spending limit', () => {
    const input = permit({ ...LAYERS['SAME_CHAIN_IE swap'] })
    const off = scope(input)
    expect(off.permissions).toHaveLength(1)
    const spender = (
      off.permissions[0].functions.approve as {
        params: { spender: { value: Address } }
      }
    ).params.spender.value
    const on = scope({ ...input, allowFees: true })
    expect(on.permissions).toEqual([])
    const action = find(on.actions, USDC, APPROVE)
    expect(action.policies?.map((p) => p.type)).not.toContain('spending-limits')
    const usage: RuleUsage = new Map()
    expect(satisfiesRules(action, approve(PAYMASTER, CAP), usage)).toBe(true)
    expect(satisfiesRules(action, approve(spender, 100n), usage)).toBe(true)
    expect(satisfiesRules(action, approve(spender, 1n), usage)).toBe(false)
    expect(satisfiesRules(action, approve(spender, 101n), new Map())).toBe(
      false,
    )
    // The Swapper actions still carry the swap's floor and pins, unchanged.
    expect(on.actions.slice(0, off.actions.length)).toEqual(off.actions)
  })
})

describe('allowFees refuses', () => {
  test('a `from` token that is not a served USD stablecoin', () => {
    expect(() =>
      scope(
        permit({
          ...LAYERS['SAME_CHAIN_IE transfer'],
          from: { chain: base, token: WETH, maxAmount: 100n },
          to: { chain: base, token: WETH, recipient: RECIPIENT },
          allowFees: true,
        }),
      ),
    ).toThrow('must be a served USD stablecoin')
  })

  test.each(Object.keys(LAYERS))('%s on a chain with no fees block', (name) => {
    expect(() =>
      scope(permit({ ...LAYERS[name], allowFees: true }), SETTLEMENT_CATALOG),
    ).toThrow('serves no fee addresses on chain 8453')
  })

  test('a SAME_CHAIN_IE permit without served settlement addresses', () => {
    const input = permit({ ...LAYERS['SAME_CHAIN_IE transfer'] })
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

test('the paymaster callback pins any of several `from` tokens', () => {
  const [action] = withFeeActions([], [USDC, USDC_ARB], FEES, []).filter(
    (a) => a.selector === CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR,
  )
  expect(satisfiesRules(action, callback(USDC, 1n), new Map())).toBe(true)
  expect(satisfiesRules(action, callback(USDC_ARB, 1n), new Map())).toBe(true)
  expect(satisfiesRules(action, callback(WETH, 1n), new Map())).toBe(false)
})

test('refuses to join an action with no params policy', () => {
  expect(() =>
    withFeeActions([{ target: USDC, selector: APPROVE }], [USDC], FEES, []),
  ).toThrow('has no params policy for allowFees to join')
})

test('refuses a swap permission that is not an approve', () => {
  expect(() =>
    permissionsAsActions(
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

test('a token served by any one layer counts as a stablecoin', () => {
  const USDT0 = SETTLEMENT_CATALOG[42161].oft!.token
  const settlement = {
    1: { oft: { adapter: STRANGER, eid: 1, token: USDT0 }, fees: FEES },
  }
  expect(servedFees(settlement, 1, [USDT0])).toEqual(FEES)
  expect(() => servedFees(settlement, 1, [USDC])).toThrow(
    'must be a served USD stablecoin',
  )
})
