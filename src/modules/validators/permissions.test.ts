import { type Address, erc20Abi, toFunctionSelector } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../test/consts'
import { resolvePermission, resolvePermissions } from './permissions'
import { getSessionData, toSession } from './smart-sessions'

const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const RECIPIENT: Address = '0x1111111111111111111111111111111111111111'

describe('resolvePermission', () => {
  test('ERC-20 transfer with param rules', () => {
    const actions = resolvePermission({
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

  test('multiple functions on the same contract', () => {
    const actions = resolvePermission({
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

  test('policies only — no universal-action generated', () => {
    const actions = resolvePermission({
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

  test('user policies come before generated universal-action', () => {
    const actions = resolvePermission({
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

    const actions = resolvePermission({
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

    const actionsTrue = resolvePermission({
      abi,
      address: USDC,
      functions: {
        setFlag: { params: { flag: { condition: 'equal', value: true } } },
      },
    })
    const actionsFalse = resolvePermission({
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

  test('validates bytesN values are fixed-size hex strings', () => {
    const abi = [
      {
        type: 'function',
        name: 'setBytes',
        inputs: [{ name: 'value', type: 'bytes4' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const

    const actions = resolvePermission({
      abi,
      address: USDC,
      functions: {
        setBytes: {
          params: {
            value: { condition: 'equal', value: '0x12345678' },
          },
        },
      },
    })

    const policy = actions[0].policies![0]
    if (policy.type !== 'universal-action') throw new Error('wrong type')
    expect(policy.rules[0].referenceValue).toBe('0x12345678')
  })

  test('throws for invalid bytesN values', () => {
    const abi = [
      {
        type: 'function',
        name: 'setBytes',
        inputs: [{ name: 'value', type: 'bytes4' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const

    for (const value of ['nothex', '0x123', '0x1234567890']) {
      expect(() =>
        resolvePermission({
          abi,
          address: USDC,
          functions: {
            setBytes: {
              params: {
                value: { condition: 'equal', value },
              },
            },
          },
        }),
      ).toThrow(/4-byte hex string/)
    }
  })

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
      resolvePermission({
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
      resolvePermission({
        abi,
        address: USDC,
        functions: {
          transfer: { policies: [{ type: 'sudo' }] },
        },
      }),
    ).toThrow(/overloaded/)
  })

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
      resolvePermission({
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

  test('empty functions object returns empty array', () => {
    const actions = resolvePermission({
      abi: erc20Abi,
      address: USDC,
      functions: {},
    })
    expect(actions).toEqual([])
  })

  test('valueLimitPerUse without params becomes value-limit policy', () => {
    const actions = resolvePermission({
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

  test('valueLimitPerUse with params sets it on universal-action', () => {
    const actions = resolvePermission({
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

  test('usageLimit is forwarded to param rule', () => {
    const actions = resolvePermission({
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

  test('function with no config produces action without policies', () => {
    const actions = resolvePermission({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {},
      },
    })

    expect(actions).toHaveLength(1)
    expect(actions[0].policies).toBeUndefined()
  })

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
      resolvePermission({
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

describe('resolvePermissions', () => {
  test('flattens multiple contracts into one action list', () => {
    const usdc: Address = '0x2222222222222222222222222222222222222222'
    const dai: Address = '0x3333333333333333333333333333333333333333'

    const actions = resolvePermissions([
      {
        abi: erc20Abi,
        address: usdc,
        functions: { transfer: { policies: [{ type: 'sudo' }] } },
      },
      {
        abi: erc20Abi,
        address: dai,
        functions: { approve: { policies: [{ type: 'sudo' }] } },
      },
    ])

    expect(actions).toHaveLength(2)
    expect(actions[0].target).toBe(usdc)
    expect(actions[1].target).toBe(dai)
  })

  test('Session.permissions feeds into getSessionData without errors', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
      permissions: [
        {
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
        },
      ],
    })

    const data = getSessionData(session)
    // User action + injected WETH deposit + injected intent-execution fallback
    // + injected dummy preclaimop
    expect(data.actions.length).toBeGreaterThanOrEqual(2)
    expect(data.actions[0].actionTarget).toBe(USDC)
  })
})
