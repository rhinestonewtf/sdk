import { type Address, erc20Abi, type Hex, toFunctionSelector } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../test/consts'
import { getSessionData } from '../modules/validators/smart-sessions'
import type { Session } from '../types'
import { definePermissions } from './permissions'

const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const RECIPIENT: Address = '0x1111111111111111111111111111111111111111'

// ---------------------------------------------------------------------------
// A. Basic param rules
// ---------------------------------------------------------------------------

describe('definePermissions', () => {
  test('ERC-20 transfer with param rules', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: { condition: 'equal', value: RECIPIENT },
            amount: { condition: 'lessThan', value: 1000n },
          },
        },
      },
    })

    expect(actions).toHaveLength(1)
    const action = actions[0]
    expect(action.target).toBe(USDC)
    expect(action.selector).toBe(
      toFunctionSelector(
        'function transfer(address recipient, uint256 amount)',
      ),
    )
    expect(action.policies).toHaveLength(1)

    const policy = action.policies![0]
    expect(policy.type).toBe('universal-action')
    if (policy.type !== 'universal-action') throw new Error('wrong type')

    expect(policy.valueLimitPerUse).toBe(0n)
    expect(policy.rules).toHaveLength(2)

    const recipientRule = policy.rules.find((r) => r.calldataOffset === 0n)!
    expect(recipientRule.condition).toBe('equal')
    expect(recipientRule.referenceValue).toBe(RECIPIENT)

    const amountRule = policy.rules.find((r) => r.calldataOffset === 32n)!
    expect(amountRule.condition).toBe('lessThan')
    expect(amountRule.referenceValue).toBe(1000n)
  })

  // ---------------------------------------------------------------------------
  // B. Multiple functions
  // ---------------------------------------------------------------------------

  test('multiple functions on the same contract', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          policies: [{ type: 'usage-limit', limit: 10n }],
        },
        approve: {
          policies: [{ type: 'usage-limit', limit: 5n }],
        },
      },
    })

    expect(actions).toHaveLength(2)
    const names = actions.map((a) => a.selector).sort()
    const expectedSelectors = [
      toFunctionSelector('function transfer(address to, uint256 value)'),
      toFunctionSelector('function approve(address spender, uint256 value)'),
    ].sort()
    expect(names).toEqual(expectedSelectors)
  })

  // ---------------------------------------------------------------------------
  // C. Policies without params
  // ---------------------------------------------------------------------------

  test('policies only — no universal-action generated', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        approve: {
          policies: [{ type: 'sudo' }],
        },
      },
    })

    expect(actions).toHaveLength(1)
    expect(actions[0].policies).toEqual([{ type: 'sudo' }])
  })

  // ---------------------------------------------------------------------------
  // D. Params + policies combined
  // ---------------------------------------------------------------------------

  test('user policies come before generated universal-action', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          policies: [{ type: 'usage-limit', limit: 3n }],
          params: {
            recipient: { condition: 'equal', value: RECIPIENT },
          },
        },
      },
    })

    const policies = actions[0].policies!
    expect(policies).toHaveLength(2)
    expect(policies[0].type).toBe('usage-limit')
    expect(policies[1].type).toBe('universal-action')
  })

  // ---------------------------------------------------------------------------
  // E. Third parameter offset
  // ---------------------------------------------------------------------------

  test('calldataOffset for third parameter is 64n', () => {
    const customAbi = [
      {
        type: 'function',
        name: 'foo',
        inputs: [
          { name: 'a', type: 'address' },
          { name: 'b', type: 'uint256' },
          { name: 'c', type: 'bool' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const

    const actions = definePermissions({
      abi: customAbi,
      address: USDC,
      functions: {
        foo: {
          params: {
            c: { condition: 'equal', value: true },
          },
        },
      },
    })

    const policy = actions[0].policies![0]
    if (policy.type !== 'universal-action') throw new Error('wrong type')
    expect(policy.rules[0].calldataOffset).toBe(64n)
  })

  // ---------------------------------------------------------------------------
  // F. Boolean conversion
  // ---------------------------------------------------------------------------

  test('boolean true → 1n, false → 0n', () => {
    const abi = [
      {
        type: 'function',
        name: 'setFlag',
        inputs: [{ name: 'flag', type: 'bool' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const

    const actionsTrue = definePermissions({
      abi,
      address: USDC,
      functions: {
        setFlag: { params: { flag: { condition: 'equal', value: true } } },
      },
    })
    const actionsFalse = definePermissions({
      abi,
      address: USDC,
      functions: {
        setFlag: { params: { flag: { condition: 'equal', value: false } } },
      },
    })

    const ruleT = (actionsTrue[0].policies![0] as any).rules[0]
    const ruleF = (actionsFalse[0].policies![0] as any).rules[0]
    expect(ruleT.referenceValue).toBe(1n)
    expect(ruleF.referenceValue).toBe(0n)
  })

  // ---------------------------------------------------------------------------
  // G. Dynamic param type → throws
  // ---------------------------------------------------------------------------

  test('throws for dynamic parameter types', () => {
    const abi = [
      {
        type: 'function',
        name: 'send',
        inputs: [{ name: 'data', type: 'bytes' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const

    expect(() =>
      definePermissions({
        abi,
        address: USDC,
        functions: {
          send: {
            params: {
              // @ts-expect-error — value is `never` for dynamic types
              data: { condition: 'equal', value: '0x1234' },
            },
          },
        },
      }),
    ).toThrow(/dynamic type/)
  })

  // ---------------------------------------------------------------------------
  // H. Overloaded function → throws
  // ---------------------------------------------------------------------------

  test('throws for overloaded functions', () => {
    const abi = [
      {
        type: 'function',
        name: 'transfer',
        inputs: [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
      },
      {
        type: 'function',
        name: 'transfer',
        inputs: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const

    expect(() =>
      definePermissions({
        abi,
        address: USDC,
        functions: {
          transfer: { policies: [{ type: 'sudo' }] },
        },
      }),
    ).toThrow(/overloaded/)
  })

  // ---------------------------------------------------------------------------
  // I. Unknown param name → throws
  // ---------------------------------------------------------------------------

  test('throws for unknown parameter name', () => {
    const abi = [
      {
        type: 'function',
        name: 'foo',
        inputs: [{ name: 'bar', type: 'uint256' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const

    expect(() =>
      definePermissions({
        abi,
        address: USDC,
        functions: {
          foo: {
            params: {
              // @ts-expect-error — 'baz' doesn't exist
              baz: { condition: 'equal', value: 1n },
            },
          },
        },
      }),
    ).toThrow(/not found/)
  })

  // ---------------------------------------------------------------------------
  // J. Empty functions → []
  // ---------------------------------------------------------------------------

  test('empty functions object returns empty array', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {},
    })
    expect(actions).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // K. valueLimitPerUse without params → value-limit policy
  // ---------------------------------------------------------------------------

  test('valueLimitPerUse without params becomes value-limit policy', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        approve: {
          valueLimitPerUse: 100n,
        },
      },
    })

    expect(actions[0].policies).toEqual([{ type: 'value-limit', limit: 100n }])
  })

  // ---------------------------------------------------------------------------
  // L. valueLimitPerUse with params → part of universal-action
  // ---------------------------------------------------------------------------

  test('valueLimitPerUse with params sets it on universal-action', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          valueLimitPerUse: 500n,
          params: {
            recipient: { condition: 'equal', value: RECIPIENT },
          },
        },
      },
    })

    const policy = actions[0].policies![0]
    if (policy.type !== 'universal-action') throw new Error('wrong type')
    expect(policy.valueLimitPerUse).toBe(500n)
  })

  // ---------------------------------------------------------------------------
  // M. usageLimit on param rule
  // ---------------------------------------------------------------------------

  test('usageLimit is forwarded to param rule', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: {
              condition: 'equal',
              value: RECIPIENT,
              usageLimit: 5n,
            },
          },
        },
      },
    })

    const policy = actions[0].policies![0]
    if (policy.type !== 'universal-action') throw new Error('wrong type')
    expect(policy.rules[0].usageLimit).toBe(5n)
  })

  // ---------------------------------------------------------------------------
  // N. No policies and no params → action with no policies key
  // ---------------------------------------------------------------------------

  test('function with no config produces action without policies', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {},
      },
    })

    expect(actions).toHaveLength(1)
    expect(actions[0].policies).toBeUndefined()
  })

  // ---------------------------------------------------------------------------
  // O. Composability — result works inside Session.actions
  // ---------------------------------------------------------------------------

  test('result can be spread into Session.actions', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          policies: [{ type: 'sudo' }],
        },
      },
    })

    const session: Session = {
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      actions: [...actions],
    }

    expect(session.actions).toHaveLength(1)
  })

  // ---------------------------------------------------------------------------
  // P. End-to-end with getSessionData
  // ---------------------------------------------------------------------------

  test('result feeds into getSessionData without errors', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          policies: [{ type: 'usage-limit', limit: 10n }],
          params: {
            recipient: { condition: 'equal', value: RECIPIENT },
          },
        },
      },
    })

    const session: Session = {
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      actions: [...actions],
    }

    const data = getSessionData(session)
    // User action + injected WETH deposit + injected intent-execution fallback
    expect(data.actions.length).toBeGreaterThanOrEqual(2)
    expect(data.actions[0].actionTarget).toBe(USDC)
  })

  // ---------------------------------------------------------------------------
  // Q. Function not found → throws
  // ---------------------------------------------------------------------------

  test('throws when function name not in ABI', () => {
    const abi = [
      {
        type: 'function',
        name: 'foo',
        inputs: [],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const

    expect(() =>
      definePermissions({
        abi,
        address: USDC,
        functions: {
          // @ts-expect-error — 'bar' doesn't exist in abi
          bar: { policies: [{ type: 'sudo' }] },
        },
      }),
    ).toThrow(/not found/)
  })
})

// ---------------------------------------------------------------------------
// F. anyOf → ArgPolicy
// ---------------------------------------------------------------------------

const ALICE: Address = '0xaaaa000000000000000000000000000000000001'
const BOB: Address = '0xbbbb000000000000000000000000000000000002'
const CAROL: Address = '0xcccc000000000000000000000000000000000003'

describe('definePermissions — anyOf (arg-policy)', () => {
  test('single param with anyOf emits arg-policy, no universal-action', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: { anyOf: [ALICE, BOB] },
          },
        },
      },
    })

    expect(actions).toHaveLength(1)
    const policy = actions[0].policies![0]
    expect(policy.type).toBe('arg-policy')
    if (policy.type !== 'arg-policy') throw new Error('wrong policy type')

    // Top-level: OR of two EQUAL leaves over the same offset
    expect(policy.expression.type).toBe('or')
    if (policy.expression.type !== 'or') throw new Error('wrong expr type')
    expect(policy.expression.left.type).toBe('rule')
    expect(policy.expression.right.type).toBe('rule')
    if (
      policy.expression.left.type !== 'rule' ||
      policy.expression.right.type !== 'rule'
    )
      throw new Error('wrong leaves')
    expect(policy.expression.left.rule.referenceValue).toBe(ALICE)
    expect(policy.expression.right.rule.referenceValue).toBe(BOB)
    expect(policy.expression.left.rule.condition).toBe('equal')
    expect(policy.expression.right.rule.condition).toBe('equal')
    // Both leaves point at the same calldata offset (param[0] → 0)
    expect(policy.expression.left.rule.calldataOffset).toBe(0n)
    expect(policy.expression.right.rule.calldataOffset).toBe(0n)
  })

  test('three-value anyOf right-folds: OR(a, OR(b, c))', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: { anyOf: [ALICE, BOB, CAROL] },
          },
        },
      },
    })

    const policy = actions[0].policies![0]
    if (policy.type !== 'arg-policy') throw new Error('wrong policy type')
    if (policy.expression.type !== 'or') throw new Error('expected top OR')
    if (policy.expression.left.type !== 'rule')
      throw new Error('expected left rule')
    expect(policy.expression.left.rule.referenceValue).toBe(ALICE)
    if (policy.expression.right.type !== 'or')
      throw new Error('expected nested OR')
    if (
      policy.expression.right.left.type !== 'rule' ||
      policy.expression.right.right.type !== 'rule'
    )
      throw new Error('nested OR leaves')
    expect(policy.expression.right.left.rule.referenceValue).toBe(BOB)
    expect(policy.expression.right.right.rule.referenceValue).toBe(CAROL)
  })

  test('mixed: anyOf + single-condition param → AND(OR(...), rule)', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: { anyOf: [ALICE, BOB] },
            amount: { condition: 'lessThan', value: 1000n },
          },
        },
      },
    })

    const policy = actions[0].policies![0]
    if (policy.type !== 'arg-policy') throw new Error('wrong policy type')
    expect(policy.expression.type).toBe('and')
    if (policy.expression.type !== 'and') throw new Error('expected AND')
    // OR side (recipient)
    expect(policy.expression.left.type).toBe('or')
    // single-rule side (amount lessThan 1000)
    if (policy.expression.right.type !== 'rule')
      throw new Error('expected right leaf')
    expect(policy.expression.right.rule.condition).toBe('lessThan')
    expect(policy.expression.right.rule.referenceValue).toBe(1000n)
    expect(policy.expression.right.rule.calldataOffset).toBe(32n)
  })

  test('all-single-condition params still emit universal-action (no arg-policy upgrade)', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: { condition: 'equal', value: ALICE },
            amount: { condition: 'lessThan', value: 1000n },
          },
        },
      },
    })
    const policy = actions[0].policies![0]
    expect(policy.type).toBe('universal-action')
  })

  test('empty anyOf array throws at runtime', () => {
    expect(() =>
      definePermissions({
        abi: erc20Abi,
        address: USDC,
        functions: {
          transfer: {
            params: {
              // @ts-expect-error — readonly tuple [T, ...T[]] requires ≥1 element
              recipient: { anyOf: [] },
            },
          },
        },
      }),
    ).toThrow(/empty anyOf/)
  })

  test('anyOf with one value still uses arg-policy (no premature collapse)', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: { anyOf: [ALICE] },
          },
        },
      },
    })
    const policy = actions[0].policies![0]
    // One-leaf anyOf compiles to a single rule node — emitted as arg-policy
    // for predictability (callers asked for the OR-capable variant).
    expect(policy.type).toBe('arg-policy')
    if (policy.type !== 'arg-policy') throw new Error('wrong policy type')
    expect(policy.expression.type).toBe('rule')
  })

  test('anyOf passes through getSessionData encoding (smoke)', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: { anyOf: [ALICE, BOB] },
          },
        },
      },
    })
    const session: Session = {
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      actions,
    }
    const data = getSessionData(session)
    expect(data.actions[0].actionPolicies[0].initData.length).toBeGreaterThan(2)
  })
})

// ---------------------------------------------------------------------------
// F2. bytesN reference value encoding — calldata is left-aligned + right-padded
//     so the reference value the policy compares against must use the same
//     layout, not the right-aligned form used for address/uint/bool.
// ---------------------------------------------------------------------------

describe('definePermissions — bytesN encoding', () => {
  test('bytes4 reference value is left-aligned + right-padded to bytes32', () => {
    const bytes4Abi = [
      {
        type: 'function',
        name: 'check',
        inputs: [{ name: 'sel', type: 'bytes4' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const
    const actions = definePermissions({
      abi: bytes4Abi,
      address: USDC,
      functions: {
        check: {
          params: {
            sel: { condition: 'equal', value: '0x12345678' as Hex },
          },
        },
      },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'universal-action') throw new Error('wrong policy')
    expect(policy.rules[0].referenceValue).toBe(
      // 4 value bytes + 28 zero bytes (left-aligned, right-padded)
      `0x12345678${'00'.repeat(28)}` as Hex,
    )
  })

  test('bytes1 ref value uses left-alignment, not right-alignment', () => {
    const bytes1Abi = [
      {
        type: 'function',
        name: 'check',
        inputs: [{ name: 'b', type: 'bytes1' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const
    const actions = definePermissions({
      abi: bytes1Abi,
      address: USDC,
      functions: {
        check: {
          params: { b: { condition: 'equal', value: '0xff' as Hex } },
        },
      },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'universal-action') throw new Error('wrong policy')
    // Left-aligned: high byte = 0xff, rest zero.
    // Wrong (right-aligned) form would be `0x${'00'.repeat(31)}ff`.
    expect(policy.rules[0].referenceValue).toBe(`0xff${'00'.repeat(31)}` as Hex)
    expect(policy.rules[0].referenceValue).not.toBe(
      `0x${'00'.repeat(31)}ff` as Hex,
    )
  })

  test('bytes32 ref value pre-pads to itself (no-op, dir does not matter for full word)', () => {
    const bytes32Abi = [
      {
        type: 'function',
        name: 'check',
        inputs: [{ name: 'h', type: 'bytes32' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const
    const fullHash = `0x${'ab'.repeat(32)}` as Hex
    const actions = definePermissions({
      abi: bytes32Abi,
      address: USDC,
      functions: {
        check: {
          params: { h: { condition: 'equal', value: fullHash } },
        },
      },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'universal-action') throw new Error('wrong policy')
    expect(policy.rules[0].referenceValue).toBe(fullHash)
  })

  test('address ref value still right-aligned (unchanged behavior)', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: { condition: 'equal', value: RECIPIENT },
          },
        },
      },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'universal-action') throw new Error('wrong policy')
    // For address, the encoder downstream still left-pads the 20-byte value
    // to 32 bytes; we return the raw address here so that pipeline is intact.
    expect(policy.rules[0].referenceValue).toBe(RECIPIENT)
  })

  test('bytesN anyOf path also pre-pads each value (arg-policy)', () => {
    const bytes4Abi = [
      {
        type: 'function',
        name: 'check',
        inputs: [{ name: 'sel', type: 'bytes4' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const
    const actions = definePermissions({
      abi: bytes4Abi,
      address: USDC,
      functions: {
        check: {
          params: {
            sel: {
              anyOf: ['0x11111111' as Hex, '0x22222222' as Hex] as const,
            },
          },
        },
      },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'arg-policy') throw new Error('expected arg-policy')
    if (policy.expression.type !== 'or') throw new Error('expected OR')
    if (
      policy.expression.left.type !== 'rule' ||
      policy.expression.right.type !== 'rule'
    )
      throw new Error('expected leaves')
    expect(policy.expression.left.rule.referenceValue).toBe(
      `0x11111111${'00'.repeat(28)}` as Hex,
    )
    expect(policy.expression.right.rule.referenceValue).toBe(
      `0x22222222${'00'.repeat(28)}` as Hex,
    )
  })
})

// ---------------------------------------------------------------------------
// G. Sugar fields → policy composition
// ---------------------------------------------------------------------------

// Minimal payable + non-ERC20-shape ABI for gating tests
const customAbi = [
  {
    type: 'function',
    name: 'deposit',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'configure',
    inputs: [{ name: 'flag', type: 'bool' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const VAULT: Address = '0x2222222222222222222222222222222222222222'

describe('definePermissions — sugar fields', () => {
  test('maxUses emits a usage-limit policy alongside other policies', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          maxUses: 10n,
          params: {
            recipient: { condition: 'equal', value: RECIPIENT },
          },
        },
      },
    })
    const policies = actions[0].policies!
    const usage = policies.find((p) => p.type === 'usage-limit')
    expect(usage).toBeDefined()
    if (usage?.type !== 'usage-limit') throw new Error('wrong')
    expect(usage.limit).toBe(10n)
    // universal-action still emitted from params
    expect(policies.some((p) => p.type === 'universal-action')).toBe(true)
  })

  test('validUntil only → defaults validAfter=0', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: { validUntil: new Date('2027-01-01') },
      },
    })
    const tf = actions[0].policies!.find((p) => p.type === 'time-frame')
    if (tf?.type !== 'time-frame') throw new Error('expected time-frame')
    expect(tf.validUntil).toBe(new Date('2027-01-01').getTime())
    expect(tf.validAfter).toBe(0)
  })

  test('validAfter only → defaults validUntil to far-future', () => {
    const after = new Date('2026-01-01').getTime()
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: { validAfter: after },
      },
    })
    const tf = actions[0].policies!.find((p) => p.type === 'time-frame')
    if (tf?.type !== 'time-frame') throw new Error('expected time-frame')
    expect(tf.validAfter).toBe(after)
    // Far-future = year 2100 in ms — well above any realistic validAfter
    expect(tf.validUntil).toBeGreaterThan(after)
    expect(tf.validUntil).toBeGreaterThan(new Date('2099-01-01').getTime())
  })

  test('validUntil < validAfter throws', () => {
    expect(() =>
      definePermissions({
        abi: erc20Abi,
        address: USDC,
        functions: {
          transfer: {
            validUntil: new Date('2026-01-01'),
            validAfter: new Date('2027-01-01'),
          },
        },
      }),
    ).toThrow(/before validAfter/)
  })

  test('Date and number inputs are accepted for validUntil/validAfter', () => {
    const untilDate = new Date('2027-01-01')
    const afterMs = new Date('2026-01-01').getTime()
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: { validUntil: untilDate, validAfter: afterMs },
      },
    })
    const tf = actions[0].policies!.find((p) => p.type === 'time-frame')
    if (tf?.type !== 'time-frame') throw new Error('expected time-frame')
    expect(tf.validUntil).toBe(untilDate.getTime())
    expect(tf.validAfter).toBe(afterMs)
  })

  test('spendingLimit on ERC-20 transfer → spending-limits policy', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: { spendingLimit: { token: USDC, amount: 5000n } },
      },
    })
    const sp = actions[0].policies!.find((p) => p.type === 'spending-limits')
    if (sp?.type !== 'spending-limits') throw new Error('expected sp')
    expect(sp.limits).toEqual([{ token: USDC, amount: 5000n }])
  })

  test('spendingLimit on transferFrom (3-arg variant) also accepted', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transferFrom: { spendingLimit: { token: USDC, amount: 100n } },
      },
    })
    expect(actions[0].policies!.some((p) => p.type === 'spending-limits')).toBe(
      true,
    )
  })

  test('valueLimit on payable function → value-limit policy', () => {
    const actions = definePermissions({
      abi: customAbi,
      address: VAULT,
      functions: {
        deposit: { valueLimit: 1_000_000_000_000n },
      },
    })
    const vl = actions[0].policies!.find((p) => p.type === 'value-limit')
    if (vl?.type !== 'value-limit') throw new Error('expected vl')
    expect(vl.limit).toBe(1_000_000_000_000n)
  })

  test('valueLimit on non-payable function → runtime throw (type gate bypassed)', () => {
    expect(() =>
      definePermissions({
        abi: customAbi,
        address: VAULT,
        functions: {
          // @ts-expect-error — valueLimit is `never` on non-payable functions
          configure: { valueLimit: 1n },
        },
      }),
    ).toThrow(/not payable/)
  })

  test('spendingLimit on non-ERC20-shape function → runtime throw', () => {
    expect(() =>
      definePermissions({
        abi: customAbi,
        address: VAULT,
        functions: {
          // @ts-expect-error — spendingLimit is `never` on non-ERC20-shape functions
          deposit: { spendingLimit: { token: USDC, amount: 100n } },
        },
      }),
    ).toThrow(/spendingLimit.*ERC-20/)
  })

  test('combined sugar fields all compose onto the same action', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: { anyOf: [ALICE, BOB] },
            amount: { condition: 'lessThan', value: 1000n },
          },
          maxUses: 10n,
          validUntil: new Date('2027-01-01'),
          spendingLimit: { token: USDC, amount: 5000n },
        },
      },
    })
    const policies = actions[0].policies!
    const types = policies.map((p) => p.type).sort()
    expect(types).toEqual(
      ['arg-policy', 'spending-limits', 'time-frame', 'usage-limit'].sort(),
    )
  })

  test('raw policies + sugar policies concat — duplicates not deduped', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          policies: [{ type: 'usage-limit', limit: 5n }],
          maxUses: 10n, // sugar — separate from raw
        },
      },
    })
    const usageLimits = actions[0].policies!.filter(
      (p) => p.type === 'usage-limit',
    )
    expect(usageLimits).toHaveLength(2)
    if (
      usageLimits[0].type !== 'usage-limit' ||
      usageLimits[1].type !== 'usage-limit'
    )
      throw new Error('wrong')
    const limits = [usageLimits[0].limit, usageLimits[1].limit].sort(
      (a, b) => Number(a) - Number(b),
    )
    expect(limits).toEqual([5n, 10n])
  })

  test('sugar-only function with no params still produces a ScopedAction', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          maxUses: 3n,
        },
      },
    })
    expect(actions).toHaveLength(1)
    expect(actions[0].selector).toBe(
      toFunctionSelector(
        'function transfer(address recipient, uint256 amount)',
      ),
    )
    expect(actions[0].policies).toEqual([{ type: 'usage-limit', limit: 3n }])
  })

  test('sugar policies pass through getSessionData encoding', () => {
    const actions = definePermissions({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          maxUses: 10n,
          validUntil: new Date('2027-01-01'),
          spendingLimit: { token: USDC, amount: 5000n },
        },
      },
    })
    const session: Session = {
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      actions,
    }
    const data = getSessionData(session)
    // 3 sugar policies → 3 actionPolicies entries
    expect(data.actions[0].actionPolicies).toHaveLength(3)
    data.actions[0].actionPolicies.forEach((p) => {
      expect(p.initData.length).toBeGreaterThan(2)
    })
  })
})
