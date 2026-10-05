import {
  type Address,
  type Chain,
  concat,
  decodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  hexToBigInt,
  isAddressEqual,
  maxUint256,
  pad,
  parseAbi,
  size,
  slice,
  toFunctionSelector,
  toHex,
} from 'viem'
import { arbitrum, base, plasma } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import {
  type RuleUsage,
  satisfiesRules,
} from '../../../../../test/utils/policy-rules'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { resolveCrossChainPermission } from '../cross-chain-permits'
import { encodeSessionPolicy } from '../policies/encode'
import { swapperAddresses } from '../swap/rhinestone'
import { allOf, anyOf, cumulativeCap, pin } from '../swap/rules'
import type {
  ArgPolicyExpression,
  CrossChainPermissionInput,
  FromLeg,
  ScopedAction,
  SessionPolicy,
} from '../types'
import {
  CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR,
  SETTLEMENT_FEE_CAP,
  swapApprovesAsActions,
  withFeeActions,
} from './fees'
import { resolveSettlementScope } from './scope'
import type { SettlementAddresses, SettlementCatalog } from './types'

/**
 * Enabling a session stores every action policy's config, and the cost tracks
 * the non-zero slots written. This file guards the size of what `allowFees`
 * adds: a frozen copy of the fee builder as it stood before, and a differential
 * that every valid fee call is still admitted, every one-word mutation is
 * judged the same, and every cumulative-cap sequence ends the same.
 */

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address
const WETH = '0x4200000000000000000000000000000000000006' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const RECIPIENT = '0x2222222222222222222222222222222222222222' as Address
const ATTACKER = '0x4444444444444444444444444444444444444444' as Address
const COLLECTOR = '0x5555555555555555555555555555555555555555' as Address
const PAYMASTER = '0x6666666666666666666666666666666666666666' as Address
const TRANSFER = toFunctionSelector('transfer(address,uint256)')
const APPROVE = toFunctionSelector('approve(address,uint256)')
const CAP = SETTLEMENT_FEE_CAP
const OFT_ARB = SETTLEMENT_CATALOG[arbitrum.id].oft!
const OFT_PLASMA = SETTLEMENT_CATALOG[plasma.id].oft!
const VALID_UNTIL = new Date(2_000_000_000_000)

const FEES = { appFeeCollector: COLLECTOR, paymaster: PAYMASTER }
const WITH_FEES: SettlementCatalog = {
  ...SETTLEMENT_CATALOG,
  [base.id]: { ...SETTLEMENT_CATALOG[base.id], fees: FEES },
  [arbitrum.id]: { ...SETTLEMENT_CATALOG[arbitrum.id], fees: FEES },
}
const TIME_FRAME: SessionPolicy[] = [
  { type: 'time-frame', validAfter: 0, validUntil: VALID_UNTIL.getTime() },
]

/* -------------------------------------------------------------------------- */
/*            `withFeeActions` before the size reduction, verbatim             */
/* -------------------------------------------------------------------------- */

type Fees = NonNullable<SettlementAddresses['fees']>
type ParamsPolicy = Extract<
  SessionPolicy,
  { type: 'universal-action' | 'arg-policy' }
>
const isParamsPolicy = (policy: SessionPolicy): policy is ParamsPolicy =>
  policy.type === 'universal-action' || policy.type === 'arg-policy'

function legacyAddFeeBranch(
  actions: ScopedAction[],
  target: Address,
  selector: Hex,
  branch: ArgPolicyExpression,
  timeFrame: readonly SessionPolicy[],
): void {
  const index = actions.findIndex(
    (a) => isAddressEqual(a.target, target) && a.selector === selector,
  )
  if (index === -1) {
    actions.push({
      target,
      selector,
      policies: [
        { type: 'arg-policy', valueLimitPerUse: 0n, expression: branch },
        ...timeFrame,
      ],
    })
    return
  }
  const existing = actions[index]
  const policies = existing.policies ?? []
  const layer = policies.find(isParamsPolicy)
  if (layer === undefined) throw new Error('no params policy')
  const layerExpression =
    layer.type === 'universal-action' ? allOf(layer.rules) : layer.expression
  actions[index] = {
    ...existing,
    policies: policies.map((p) =>
      p === layer
        ? {
            type: 'arg-policy',
            valueLimitPerUse: layer.valueLimitPerUse ?? 0n,
            expression: anyOf([branch, layerExpression]),
          }
        : p,
    ),
  }
}

function legacyWithFeeActions(
  actions: readonly ScopedAction[],
  sourceTokens: readonly Address[],
  fees: Fees,
  timeFrame: readonly SessionPolicy[],
): ScopedAction[] {
  const out = [...actions]
  const cap = () => cumulativeCap(32n, SETTLEMENT_FEE_CAP)
  for (const token of sourceTokens) {
    legacyAddFeeBranch(
      out,
      token,
      TRANSFER,
      allOf([pin(0n, fees.appFeeCollector), cap()]),
      timeFrame,
    )
    legacyAddFeeBranch(
      out,
      token,
      APPROVE,
      allOf([pin(0n, fees.paymaster), cap()]),
      timeFrame,
    )
  }
  legacyAddFeeBranch(
    out,
    fees.paymaster,
    CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR,
    {
      type: 'and',
      left: anyOf(sourceTokens.map((token) => allOf([pin(0n, token)]))),
      right: allOf([cap()]),
    },
    timeFrame,
  )
  return out
}

/* -------------------------------------------------------------------------- */
/*                                   Metrics                                  */
/* -------------------------------------------------------------------------- */

const ruleComponents = [
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
] as const

interface StoredRule {
  readonly condition: number
  readonly offset: bigint
  readonly isLimited: boolean
  readonly ref: Hex
  readonly usage: { readonly limit: bigint; readonly used: bigint }
}

/** Non-zero 32-byte words in an encoded policy initData. */
function nonZeroWords(initData: Hex): number {
  let count = 0
  for (let at = 0; at < size(initData); at += 32) {
    if (hexToBigInt(slice(initData, at, at + 32)) !== 0n) count++
  }
  return count
}

/**
 * The non-zero slots a params policy's `fill` writes: a rule is 4 slots
 * (condition/offset/isLimited packed, ref, limit, used). UniversalActionPolicy
 * stores its length and only the first `length` rules; ArgPolicy stores its
 * root index, both array lengths and a slot per tree node.
 */
function nonZeroSlots(policy: SessionPolicy): number {
  const { initData } = encodeSessionPolicy(policy, 'production')
  const ruleSlots = (r: StoredRule) => [
    BigInt(r.condition) | r.offset | (r.isLimited ? 1n : 0n),
    hexToBigInt(r.ref),
    r.usage.limit,
    r.usage.used,
  ]
  let slots: bigint[]
  if (policy.type === 'universal-action') {
    const [config] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'valueLimitPerUse', type: 'uint256' },
            {
              name: 'paramRules',
              type: 'tuple',
              components: [
                { name: 'length', type: 'uint256' },
                {
                  name: 'rules',
                  type: 'tuple[16]',
                  components: ruleComponents,
                },
              ],
            },
          ],
        },
      ],
      initData,
    )
    const { length, rules } = config.paramRules
    slots = [
      config.valueLimitPerUse,
      length,
      ...rules.slice(0, Number(length)).flatMap(ruleSlots),
    ]
  } else if (policy.type === 'arg-policy') {
    const [config] = decodeAbiParameters(
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
                { name: 'rules', type: 'tuple[]', components: ruleComponents },
                { name: 'packedNodes', type: 'uint256[]' },
              ],
            },
          ],
        },
      ],
      initData,
    )
    const { rootNodeIndex, rules, packedNodes } = config.paramRules
    slots = [
      config.valueLimitPerUse,
      BigInt(rootNodeIndex),
      BigInt(rules.length),
      ...rules.flatMap(ruleSlots),
      BigInt(packedNodes.length),
      ...packedNodes,
    ]
  } else {
    return 0
  }
  return slots.filter((s) => s !== 0n).length
}

const paramsPolicy = (action: ScopedAction) => {
  const policy = action.policies?.find(isParamsPolicy)
  if (!policy) throw new Error('no params policy')
  return policy
}

const ruleCount = (policy: ParamsPolicy) => {
  const walk = (e: ArgPolicyExpression): number =>
    e.type === 'rule'
      ? 1
      : e.type === 'not'
        ? walk(e.child)
        : walk(e.left) + walk(e.right)
  return policy.type === 'universal-action'
    ? policy.rules.length
    : walk(policy.expression)
}

/** One row per fee-touched action: what its params policy costs on enable. */
function measure(action: ScopedAction) {
  const policy = paramsPolicy(action)
  const { initData } = encodeSessionPolicy(policy, 'production')
  return {
    type: policy.type,
    rules: ruleCount(policy),
    initDataBytes: size(initData),
    nonZeroWords: nonZeroWords(initData),
    nonZeroSlots: nonZeroSlots(policy),
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Calldata                                  */
/* -------------------------------------------------------------------------- */

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

/** What the chain admits: the action id binds the selector, the policy the args. */
const accepts = (action: ScopedAction, calldata: Hex, usage?: RuleUsage) =>
  slice(calldata, 0, 4) === action.selector &&
  satisfiesRules(action, calldata, usage)

/** Overwrite the 32 bytes at an args offset. */
function rewrite(calldata: Hex, offset: number, value: bigint): Hex {
  const at = 4 + offset
  return concat([
    slice(calldata, 0, at),
    pad(toHex(value & maxUint256), { size: 32 }),
    ...(at + 32 < size(calldata) ? [slice(calldata, at + 32)] : []),
  ])
}

/** The selector swapped, and each args word set to +1, 0, max and an attacker. */
function mutants(calldata: Hex): Hex[] {
  const words = Math.floor((size(calldata) - 4) / 32)
  return [
    concat(['0xdeadbeef', slice(calldata, 4)]),
    ...Array.from({ length: words }, (_, i) => i * 32).flatMap((offset) => {
      const was = hexToBigInt(slice(calldata, 4 + offset, 36 + offset))
      return [was + 1n, was - 1n, 0n, maxUint256, hexToBigInt(ATTACKER)].map(
        (value) => rewrite(calldata, offset, value),
      )
    }),
  ].filter((mutant) => mutant !== calldata)
}

/* -------------------------------------------------------------------------- */
/*                                   Layers                                   */
/* -------------------------------------------------------------------------- */

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
  ECO_IE: {
    chain: base,
    token: USDC,
    spender: SETTLEMENT_CATALOG[base.id].eco!.portal,
    permit: { settlementLayers: ['ECO_IE'], maxFeeBps: 50 },
  },
  LZ: {
    chain: base,
    token: USDC,
    spender: SETTLEMENT_CATALOG[base.id].lz!.transferDelegate,
    permit: { settlementLayers: ['LZ'] },
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

const scope = (input: CrossChainPermissionInput) => {
  const resolved = resolveSettlementScope(
    [resolveCrossChainPermission(input)],
    {
      chainId: (input.from as FromLeg).chain.id,
      environment: 'production',
      account: ACCOUNT,
      oneTimeUse: true,
      settlement: WITH_FEES,
    },
  )
  if (!resolved) throw new Error('expected a settlement scope')
  return resolved
}

/** The layer's actions before the fee calls join, both builders' input. */
const baseActions = (layer: Layer) => {
  const off = scope(permit(layer))
  return [...off.actions, ...swapApprovesAsActions(off.permissions, 100n)]
}

const sameCall = (a: ScopedAction, b: ScopedAction) =>
  isAddressEqual(a.target, b.target) && a.selector === b.selector

/** Valid calls of each fee-touched action, as the existing tests admit them. */
const validCalls = (layer: Layer, tokens: readonly Address[]): Hex[] => [
  ...tokens.flatMap((token) => [
    transfer(COLLECTOR, 1n),
    transfer(COLLECTOR, CAP),
    approve(PAYMASTER, 0n),
    approve(PAYMASTER, CAP),
    callback(token, 1n),
    callback(token, CAP),
  ]),
  ...(layer.spender ? [approve(layer.spender, 100n)] : []),
  ...(layer.spender === undefined ? [transfer(RECIPIENT, 100n)] : []),
]

/** Cumulative sequences per fee-touched call, each run on a fresh session. */
const sequences = (layer: Layer, token: Address): Hex[][] => [
  [
    transfer(COLLECTOR, 3_000_000n),
    transfer(COLLECTOR, 3_000_000n),
    transfer(COLLECTOR, 2_000_000n),
    transfer(COLLECTOR, 1n),
  ],
  [transfer(COLLECTOR, CAP), transfer(COLLECTOR, 1n)],
  [transfer(COLLECTOR, CAP + 1n), transfer(COLLECTOR, CAP)],
  [
    approve(PAYMASTER, 0n),
    approve(PAYMASTER, 4_000_000n),
    approve(PAYMASTER, 0n),
    approve(PAYMASTER, 2_000_000n),
    approve(PAYMASTER, 1_000_000n),
    approve(PAYMASTER, 1n),
  ],
  [
    callback(token, 2_500_000n),
    callback(token, 2_500_000n),
    callback(token, 1n),
  ],
  [callback(token, CAP + 1n), callback(token, CAP)],
  ...(layer.spender
    ? [
        [
          approve(PAYMASTER, CAP),
          approve(layer.spender, 60n),
          approve(layer.spender, 60n),
          approve(layer.spender, 40n),
          approve(PAYMASTER, 1n),
          approve(layer.spender, 1n),
        ],
      ]
    : [
        [
          transfer(COLLECTOR, CAP),
          transfer(RECIPIENT, 100n),
          transfer(RECIPIENT, 1n),
          transfer(COLLECTOR, 1n),
        ],
      ]),
]

/** The fee-touched action that would judge `calldata`, in each build. */
const judge = (actions: readonly ScopedAction[], calldata: Hex) =>
  actions.find(
    (a) =>
      a.selector === slice(calldata, 0, 4) &&
      (a.selector === CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR
        ? isAddressEqual(a.target, PAYMASTER)
        : !isAddressEqual(a.target, PAYMASTER)),
  )

/**
 * Both builds over the same input. Each valid call is admitted by both, each
 * one-word mutation is judged the same by both, and each cumulative sequence
 * ends the same. Returns how many mutants both refused.
 */
function expectSameJudgement(
  legacy: readonly ScopedAction[],
  current: readonly ScopedAction[],
  valid: readonly Hex[],
  runs: readonly (readonly Hex[])[],
  tokens: readonly Address[],
) {
  // The legacy builder only ever touched these calls; everything else is shared.
  expect(current.map((a) => [a.target, a.selector])).toEqual(
    legacy.map((a) => [a.target, a.selector]),
  )
  let refusedByBoth = 0
  for (const calldata of valid) {
    for (const target of tokens) {
      const pick = (actions: readonly ScopedAction[]) =>
        slice(calldata, 0, 4) === CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR
          ? judge(actions, calldata)!
          : actions.find(
              (a) =>
                isAddressEqual(a.target, target) &&
                a.selector === slice(calldata, 0, 4),
            )!
      const old = pick(legacy)
      const now = pick(current)
      expect(accepts(old, calldata), `legacy admits ${calldata}`).toBe(true)
      expect(accepts(now, calldata), `current admits ${calldata}`).toBe(true)
      for (const mutant of mutants(calldata)) {
        // A swapped selector is a different action id: judge it by its own.
        const was = accepts(old, mutant)
        expect(accepts(now, mutant), `mutant ${mutant}`).toBe(was)
        if (!was) refusedByBoth++
      }
    }
  }
  for (const run of runs) {
    const usage = { legacy: new Map(), current: new Map() } as const
    const outcome = (actions: readonly ScopedAction[], map: RuleUsage) =>
      run.map((calldata) => {
        const action = judge(actions, calldata)
        return action !== undefined && accepts(action, calldata, map)
      })
    expect(outcome(current, usage.current)).toEqual(
      outcome(legacy, usage.legacy),
    )
  }
  return refusedByBoth
}

describe.each(Object.entries(LAYERS))('allowFees on %s', (_, layer) => {
  const input = baseActions(layer)
  const legacy = () =>
    legacyWithFeeActions(input, [layer.token], FEES, TIME_FRAME)
  const current = () => withFeeActions(input, [layer.token], FEES, TIME_FRAME)

  test('the frozen builder is the scoped session’s fee path', () => {
    expect(scope(permit(layer, { allowFees: true })).actions).toEqual(current())
  })

  test('no valid fee call is refused and no mutation is judged differently', () => {
    const refused = expectSameJudgement(
      legacy(),
      current(),
      validCalls(layer, [layer.token]),
      sequences(layer, layer.token),
      [layer.token],
    )
    expect(refused).toBeGreaterThan(0)
  })

  test('the actions the fees do not share are untouched', () => {
    const now = current()
    for (const action of legacy()) {
      const shared = [TRANSFER, APPROVE].includes(action.selector)
      if (!shared && action.selector !== CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR) {
        expect(now.find((a) => sameCall(a, action))).toEqual(action)
      }
    }
  })
})

describe('two `from` tokens', () => {
  const tokens = [USDC, USDC_ARB]
  const legacy = legacyWithFeeActions([], tokens, FEES, TIME_FRAME)
  const current = withFeeActions([], tokens, FEES, TIME_FRAME)

  test('no valid fee call is refused and no mutation is judged differently', () => {
    const valid = tokens.flatMap((token) => [
      transfer(COLLECTOR, CAP),
      approve(PAYMASTER, 0n),
      approve(PAYMASTER, CAP),
      callback(token, 1n),
      callback(token, CAP),
    ])
    const refused = expectSameJudgement(
      legacy,
      current,
      valid,
      [
        [callback(USDC, 3_000_000n), callback(USDC_ARB, 3_000_000n)],
        [callback(USDC, 3_000_000n), callback(USDC_ARB, 2_000_000n)],
        [callback(WETH, 1n), callback(USDC_ARB, CAP)],
      ],
      tokens,
    )
    expect(refused).toBeGreaterThan(0)
  })

  test('the callback keeps one budget across tokens', () => {
    const [old, now] = [legacy, current].map(
      (actions) =>
        actions.find((a) => a.selector === CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR)!,
    )
    for (const action of [old, now]) {
      const usage: RuleUsage = new Map()
      expect(accepts(action, callback(USDC, 3_000_000n), usage)).toBe(true)
      expect(accepts(action, callback(USDC_ARB, 3_000_000n), usage)).toBe(false)
      expect(accepts(action, callback(USDC_ARB, 2_000_000n), usage)).toBe(true)
    }
  })
})

describe('policy size on enable', () => {
  const rows = (actions: readonly ScopedAction[], token: Address) =>
    Object.fromEntries(
      [
        ['transfer', token, TRANSFER],
        ['approve', token, APPROVE],
        ['callback', PAYMASTER, CALLBACK_ALLOW_MAX_AMOUNT_SELECTOR],
      ].map(([name, target, selector]) => {
        const action = actions.find(
          (a) =>
            isAddressEqual(a.target, target as Address) &&
            a.selector === selector,
        )
        return [name, action ? measure(action) : null]
      }),
    )
  const slotsOf = (actions: readonly ScopedAction[]) =>
    actions.reduce((sum, a) => sum + nonZeroSlots(paramsPolicy(a)), 0)

  test('non-zero slots the fee calls add, before and after', () => {
    const table = Object.fromEntries(
      Object.entries(LAYERS).map(([name, layer]) => {
        const input = baseActions(layer)
        const args = [input, [layer.token], FEES, TIME_FRAME] as const
        const old = legacyWithFeeActions(...args)
        const now = withFeeActions(...args)
        return [
          name,
          {
            withoutFees: slotsOf(input),
            addedBefore: slotsOf(old) - slotsOf(input),
            addedAfter: slotsOf(now) - slotsOf(input),
          },
        ]
      }),
    )
    expect(table).toMatchInlineSnapshot(`
      {
        "CCTP": {
          "addedAfter": 30,
          "addedBefore": 30,
          "withoutFees": 16,
        },
        "ECO_IE": {
          "addedAfter": 30,
          "addedBefore": 30,
          "withoutFees": 130,
        },
        "LZ": {
          "addedAfter": 30,
          "addedBefore": 30,
          "withoutFees": 362,
        },
        "OFT": {
          "addedAfter": 30,
          "addedBefore": 30,
          "withoutFees": 30,
        },
        "SAME_CHAIN_IE swap": {
          "addedAfter": 30,
          "addedBefore": 30,
          "withoutFees": 27,
        },
        "SAME_CHAIN_IE transfer": {
          "addedAfter": 30,
          "addedBefore": 30,
          "withoutFees": 5,
        },
      }
    `)
  })

  test('per action, CCTP on Base', () => {
    const input = baseActions(LAYERS.CCTP)
    const args = [input, [USDC], FEES, TIME_FRAME] as const
    expect({
      before: rows(legacyWithFeeActions(...args), USDC),
      after: rows(withFeeActions(...args), USDC),
    }).toMatchInlineSnapshot(`
      {
        "after": {
          "approve": {
            "initDataBytes": 1248,
            "nonZeroSlots": 17,
            "nonZeroWords": 25,
            "rules": 4,
            "type": "arg-policy",
          },
          "callback": {
            "initDataBytes": 736,
            "nonZeroSlots": 9,
            "nonZeroWords": 15,
            "rules": 2,
            "type": "arg-policy",
          },
          "transfer": {
            "initDataBytes": 736,
            "nonZeroSlots": 9,
            "nonZeroWords": 15,
            "rules": 2,
            "type": "arg-policy",
          },
        },
        "before": {
          "approve": {
            "initDataBytes": 1248,
            "nonZeroSlots": 17,
            "nonZeroWords": 25,
            "rules": 4,
            "type": "arg-policy",
          },
          "callback": {
            "initDataBytes": 736,
            "nonZeroSlots": 9,
            "nonZeroWords": 15,
            "rules": 2,
            "type": "arg-policy",
          },
          "transfer": {
            "initDataBytes": 736,
            "nonZeroSlots": 9,
            "nonZeroWords": 15,
            "rules": 2,
            "type": "arg-policy",
          },
        },
      }
    `)
  })
})
