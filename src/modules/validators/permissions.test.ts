import { type Address, erc20Abi, toFunctionSelector } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../test/consts'
import { resolvePermission, resolvePermissions } from './permissions'
import { getSessionData } from './smart-sessions/digest'
import { toSession } from './smart-sessions/resolve'

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
          maxUses: 10n,
        },
        approve: {
          maxUses: 5n,
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

  test('bytesN values are right-padded to 32 bytes (matches calldata alignment)', () => {
    // Solidity calldata encodes bytesN (N<32) left-aligned + right-padded inside
    // its 32-byte word, whereas downstream encodeActionParamRule left-pads with
    // padHex. resolvePermission pre-pads with `dir: 'right'` so the downstream
    // left-pad becomes idempotent and the policy comparison matches calldata.
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
    expect(policy.rules[0].referenceValue).toBe(`0x12345678${'00'.repeat(28)}`)
  })

  test('bytes32 values are passed through unchanged (already 32 bytes)', () => {
    const abi = [
      {
        type: 'function',
        name: 'setHash',
        inputs: [{ name: 'h', type: 'bytes32' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const

    const full =
      '0x1122334455667788112233445566778811223344556677881122334455667788' as const
    const actions = resolvePermission({
      abi,
      address: USDC,
      functions: {
        setHash: { params: { h: { condition: 'equal', value: full } } },
      },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'universal-action') throw new Error('wrong type')
    expect(policy.rules[0].referenceValue).toBe(full)
  })

  test('bytes1 values are right-padded with 31 zero bytes', () => {
    const abi = [
      {
        type: 'function',
        name: 'setOne',
        inputs: [{ name: 'b', type: 'bytes1' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const

    const actions = resolvePermission({
      abi,
      address: USDC,
      functions: {
        setOne: { params: { b: { condition: 'equal', value: '0xff' } } },
      },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'universal-action') throw new Error('wrong type')
    expect(policy.rules[0].referenceValue).toBe(`0xff${'00'.repeat(31)}`)
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

  test('throws when a param value does not match its static ABI type', () => {
    const abi = [
      {
        type: 'function',
        name: 'setFlag',
        inputs: [{ name: 'flag', type: 'bool' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const
    const resolve =
      (permission: Parameters<typeof resolvePermission>[0]) => () =>
        resolvePermission(permission)

    expect(
      resolve({
        abi: erc20Abi,
        address: USDC,
        functions: {
          transfer: {
            params: {
              recipient: { condition: 'equal', value: 'not-an-address' },
            },
          },
        },
      }),
    ).toThrow('Expected address value, got: string')
    expect(
      resolve({
        abi,
        address: USDC,
        functions: {
          setFlag: { params: { flag: { condition: 'equal', value: 1n } } },
        },
      }),
    ).toThrow('Expected boolean value, got: bigint')
    expect(
      resolve({
        abi: erc20Abi,
        address: USDC,
        functions: {
          transfer: {
            params: { amount: { condition: 'equal', value: '1000' } },
          },
        },
      }),
    ).toThrow('Expected bigint value for uint256, got: string')
  })

  test('accepts numbers for integer params', () => {
    const actions = resolvePermission({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: { params: { amount: { condition: 'equal', value: 1000 } } },
      },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'universal-action') throw new Error('wrong type')
    expect(policy.rules[0].referenceValue).toBe(1000n)
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
              // Runtime backstop for dynamic values received without type safety.
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
          transfer: {},
        },
      }),
    ).toThrow(/overloaded/)
  })

  test('throws when removed policies escape hatch is provided at runtime', () => {
    expect(() =>
      resolvePermission({
        abi: erc20Abi,
        address: USDC,
        functions: {
          transfer: {
            policies: [{ type: 'usage-limit', limit: 1n }],
          } as never,
        },
      }),
    ).toThrow(/`policies` was removed/)
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
              // Runtime backstop for unknown parameter names.
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
          // Runtime backstop for unknown function names.
          bar: {},
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
        functions: { transfer: {} },
      },
      {
        abi: erc20Abi,
        address: dai,
        functions: { approve: {} },
      },
    ])

    expect(actions).toHaveLength(2)
    expect(actions[0].target).toBe(usdc)
    expect(actions[1].target).toBe(dai)
  })

  test('throws on duplicate (target, function) across permission entries', () => {
    const recipientB: Address = '0x2222222222222222222222222222222222222222'

    expect(() =>
      resolvePermissions([
        {
          abi: erc20Abi,
          address: USDC,
          functions: {
            transfer: {
              params: { recipient: { condition: 'equal', value: RECIPIENT } },
            },
          },
        },
        {
          abi: erc20Abi,
          address: USDC,
          functions: {
            transfer: {
              params: { recipient: { condition: 'equal', value: recipientB } },
            },
          },
        },
      ]),
    ).toThrow(
      new RegExp(`Duplicate permission for function "transfer".*on ${USDC}`),
    )
  })

  test('duplicate detection is case-insensitive on the target address', () => {
    expect(() =>
      resolvePermissions([
        {
          abi: erc20Abi,
          address: USDC,
          functions: { transfer: {} },
        },
        {
          abi: erc20Abi,
          address: USDC.toLowerCase() as Address,
          functions: { transfer: {} },
        },
      ]),
    ).toThrow(/Duplicate permission/)
  })

  test('same function on different contracts is allowed', () => {
    const dai: Address = '0x3333333333333333333333333333333333333333'

    const actions = resolvePermissions([
      { abi: erc20Abi, address: USDC, functions: { transfer: {} } },
      { abi: erc20Abi, address: dai, functions: { transfer: {} } },
    ])

    expect(actions).toHaveLength(2)
  })

  test('different functions on the same contract are allowed', () => {
    const actions = resolvePermissions([
      { abi: erc20Abi, address: USDC, functions: { transfer: {} } },
      { abi: erc20Abi, address: USDC, functions: { approve: {} } },
    ])

    expect(actions).toHaveLength(2)
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
              maxUses: 10n,
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

// ---------------------------------------------------------------------------
// anyOf: OR-of-EQUAL allowlists → emits arg-policy
// ---------------------------------------------------------------------------

describe('resolvePermission anyOf', () => {
  const ALICE: Address = '0x4444444444444444444444444444444444444444'
  const BOB: Address = '0x5555555555555555555555555555555555555555'
  const CAROL: Address = '0x6666666666666666666666666666666666666666'

  test('anyOf on a single param switches the emitted policy to arg-policy', () => {
    const actions = resolvePermission({
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
    const policy = actions[0].policies![0]
    expect(policy.type).toBe('arg-policy')
    if (policy.type !== 'arg-policy') throw new Error('wrong type')
    // Two-element anyOf becomes a single OR of two RULE leaves.
    expect(policy.expression.type).toBe('or')
  })

  test('anyOf with a single value compiles to a bare rule (no OR wrapper)', () => {
    const actions = resolvePermission({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: { params: { recipient: { anyOf: [ALICE] } } },
      },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'arg-policy') throw new Error('wrong type')
    expect(policy.expression.type).toBe('rule')
  })

  test('mixing anyOf and single-condition AND-composes across params', () => {
    const actions = resolvePermission({
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
    if (policy.type !== 'arg-policy') throw new Error('wrong type')
    // Top-level AND between recipient sub-expression and amount rule.
    expect(policy.expression.type).toBe('and')
  })

  test('all-single-condition params keep emitting universal-action (cheaper init)', () => {
    const actions = resolvePermission({
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
    expect(actions[0].policies![0].type).toBe('universal-action')
  })

  test('three-element anyOf builds a right-leaning OR chain (OR(a, OR(b, c)))', () => {
    const actions = resolvePermission({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: { params: { recipient: { anyOf: [ALICE, BOB, CAROL] } } },
      },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'arg-policy') throw new Error('wrong type')
    expect(policy.expression.type).toBe('or')
    if (policy.expression.type !== 'or') throw new Error()
    expect(policy.expression.left.type).toBe('rule')
    expect(policy.expression.right.type).toBe('or')
  })

  test('throws on empty anyOf', () => {
    expect(() =>
      resolvePermission({
        abi: erc20Abi,
        address: USDC,
        functions: {
          // Runtime backstop for an empty allowlist.
          transfer: { params: { recipient: { anyOf: [] } } },
        },
      }),
    ).toThrow(/empty anyOf/)
  })
})

// ---------------------------------------------------------------------------
// Sugar fields: maxUses, validUntil/validAfter, valueLimit, spendingLimit
// ---------------------------------------------------------------------------

describe('resolvePermission sugar fields', () => {
  test('maxUses emits a standalone usage-limit policy', () => {
    const actions = resolvePermission({
      abi: erc20Abi,
      address: USDC,
      functions: { transfer: { maxUses: 10n } },
    })
    expect(actions[0].policies).toEqual([{ type: 'usage-limit', limit: 10n }])
  })

  test('validUntil + validAfter compose into a single time-frame policy', () => {
    const until = new Date('2027-01-01').getTime()
    const after = new Date('2026-01-01').getTime()
    const actions = resolvePermission({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          validUntil: new Date('2027-01-01'),
          validAfter: new Date('2026-01-01'),
        },
      },
    })
    expect(actions[0].policies).toEqual([
      { type: 'time-frame', validUntil: until, validAfter: after },
    ])
  })

  test('one-sided validUntil defaults validAfter to 0', () => {
    const until = new Date('2027-01-01').getTime()
    const actions = resolvePermission({
      abi: erc20Abi,
      address: USDC,
      functions: { transfer: { validUntil: new Date('2027-01-01') } },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'time-frame') throw new Error('wrong type')
    expect(policy.validUntil).toBe(until)
    expect(policy.validAfter).toBe(0)
  })

  test('one-sided validAfter defaults validUntil to year-2100 sentinel', () => {
    const after = new Date('2026-01-01').getTime()
    const actions = resolvePermission({
      abi: erc20Abi,
      address: USDC,
      functions: { transfer: { validAfter: new Date('2026-01-01') } },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'time-frame') throw new Error('wrong type')
    expect(policy.validUntil).toBe(4_102_444_800_000)
    expect(policy.validAfter).toBe(after)
  })

  test('rejects validUntil < validAfter', () => {
    expect(() =>
      resolvePermission({
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

  test('spendingLimit on an ERC-20-transfer-shaped ABI emits spending-limits', () => {
    const actions = resolvePermission({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: { spendingLimit: { token: USDC, amount: 5000n } },
      },
    })
    expect(actions[0].policies).toEqual([
      { type: 'spending-limits', limits: [{ token: USDC, amount: 5000n }] },
    ])
  })

  test('spendingLimit on a non-ERC-20 shape throws (runtime backstop)', () => {
    const abi = [
      {
        type: 'function',
        name: 'deposit',
        inputs: [{ name: 'amount', type: 'uint256' }],
        outputs: [],
        stateMutability: 'payable',
      },
    ] as const
    expect(() =>
      resolvePermission({
        abi,
        address: USDC,
        functions: {
          // Runtime backstop for non-ERC-20 functions.
          deposit: { spendingLimit: { token: USDC, amount: 5000n } },
        },
      }),
    ).toThrow(/not an ERC-20 transfer\/approve selector/)
  })

  test('spendingLimit on an ERC-20-shaped non-ERC-20 selector throws (e.g. mint)', () => {
    // mint(address,uint256) has the same calldata shape as transfer/approve
    // but a different selector. On-chain ERC20SpendingLimitPolicy dispatches
    // by selector, so it would fail every call — reject at SDK level.
    const abi = [
      {
        type: 'function',
        name: 'mint',
        inputs: [
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
          // Runtime backstop for unsupported selectors.
          mint: { spendingLimit: { token: USDC, amount: 5000n } },
        },
      }),
    ).toThrow(/not an ERC-20 transfer\/approve selector/)
  })

  test('valueLimit on a payable function emits value-limit', () => {
    const abi = [
      {
        type: 'function',
        name: 'deposit',
        inputs: [],
        outputs: [],
        stateMutability: 'payable',
      },
    ] as const
    const actions = resolvePermission({
      abi,
      address: USDC,
      functions: { deposit: { valueLimit: 1_000_000n } },
    })
    expect(actions[0].policies).toEqual([
      { type: 'value-limit', limit: 1_000_000n },
    ])
  })

  test('valueLimit on a non-payable function throws (runtime backstop)', () => {
    expect(() =>
      resolvePermission({
        abi: erc20Abi,
        address: USDC,
        functions: {
          // Runtime backstop for non-payable functions.
          transfer: { valueLimit: 100n },
        },
      }),
    ).toThrow(/not payable/)
  })

  test('valueLimit sugar propagates to universal-action valueLimitPerUse (single-condition params)', () => {
    const abi = [
      {
        type: 'function',
        name: 'deposit',
        inputs: [{ name: 'recipient', type: 'address' }],
        outputs: [],
        stateMutability: 'payable',
      },
    ] as const
    const actions = resolvePermission({
      abi,
      address: USDC,
      functions: {
        deposit: {
          valueLimit: 1_000_000n,
          params: {
            recipient: { condition: 'equal', value: RECIPIENT },
          },
        },
      },
    })

    const policies = actions[0].policies!
    expect(policies.map((p) => p.type).sort()).toEqual(
      ['universal-action', 'value-limit'].sort(),
    )
    const uni = policies.find((p) => p.type === 'universal-action')!
    if (uni.type !== 'universal-action') throw new Error('wrong type')
    // Without this propagation, msg.value > 0 would fail the action policy's
    // `value <= valueLimitPerUse` check before the standalone value-limit
    // policy could allow it.
    expect(uni.valueLimitPerUse).toBe(1_000_000n)
  })

  test('valueLimit sugar propagates to arg-policy valueLimitPerUse (anyOf params)', () => {
    const abi = [
      {
        type: 'function',
        name: 'deposit',
        inputs: [{ name: 'recipient', type: 'address' }],
        outputs: [],
        stateMutability: 'payable',
      },
    ] as const
    const actions = resolvePermission({
      abi,
      address: USDC,
      functions: {
        deposit: {
          valueLimit: 1_000_000n,
          params: {
            recipient: { anyOf: [RECIPIENT] },
          },
        },
      },
    })

    const policies = actions[0].policies!
    expect(policies.map((p) => p.type).sort()).toEqual(
      ['arg-policy', 'value-limit'].sort(),
    )
    const arg = policies.find((p) => p.type === 'arg-policy')!
    if (arg.type !== 'arg-policy') throw new Error('wrong type')
    expect(arg.valueLimitPerUse).toBe(1_000_000n)
  })

  test('explicit valueLimitPerUse wins over valueLimit sugar', () => {
    const abi = [
      {
        type: 'function',
        name: 'deposit',
        inputs: [{ name: 'recipient', type: 'address' }],
        outputs: [],
        stateMutability: 'payable',
      },
    ] as const
    const actions = resolvePermission({
      abi,
      address: USDC,
      functions: {
        deposit: {
          valueLimit: 1_000_000n,
          valueLimitPerUse: 7n,
          params: {
            recipient: { condition: 'equal', value: RECIPIENT },
          },
        },
      },
    })

    const uni = actions[0].policies!.find((p) => p.type === 'universal-action')!
    if (uni.type !== 'universal-action') throw new Error('wrong type')
    expect(uni.valueLimitPerUse).toBe(7n)
  })

  test('all sugar fields stack with params (arg-policy + usage + time-frame + spending)', () => {
    const actions = resolvePermission({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: { anyOf: [RECIPIENT] },
          },
          maxUses: 10n,
          validUntil: new Date('2027-01-01'),
          spendingLimit: { token: USDC, amount: 5000n },
        },
      },
    })
    const types = actions[0].policies!.map((p) => p.type).sort()
    expect(types).toEqual(
      ['arg-policy', 'spending-limits', 'time-frame', 'usage-limit'].sort(),
    )
  })
})

// The on-chain policy reads calldata[4+offset : 4+offset+32]. Anything that
// makes a preceding param occupy more (or fewer) than one head word shifts every
// later param. `paramIndex * 32` got these wrong silently — the rule still
// compiled and still evaluated, just against unrelated bytes.
describe('resolvePermission — calldata head offsets', () => {
  function offsetOf(abi: readonly unknown[], fn: string, param: string) {
    const actions = resolvePermission({
      // biome-ignore lint/suspicious/noExplicitAny: local ad-hoc ABIs
      abi: abi as any,
      address: USDC,
      functions: {
        [fn]: { params: { [param]: { condition: 'equal', value: RECIPIENT } } },
      },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'universal-action') throw new Error('wrong type')
    return policy.rules[0].calldataOffset
  }

  const fn = (inputs: readonly unknown[]) =>
    [
      {
        type: 'function',
        name: 'f',
        inputs,
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const

  test('single-word static params are unchanged (regression guard)', () => {
    expect(
      offsetOf(
        fn([
          { name: 'a', type: 'uint256' },
          { name: 'b', type: 'address' },
        ]),
        'f',
        'b',
      ),
    ).toBe(32n)
  })

  test('fixed-size static array preceding occupies its full length', () => {
    // uint256[3] = 3 words inline, so `b` sits at word 3, not word 1.
    expect(
      offsetOf(
        fn([
          { name: 'a', type: 'uint256[3]' },
          { name: 'b', type: 'address' },
        ]),
        'f',
        'b',
      ),
    ).toBe(96n)
  })

  test('static tuple preceding is flattened inline', () => {
    expect(
      offsetOf(
        fn([
          {
            name: 'a',
            type: 'tuple',
            components: [
              { name: 'x', type: 'uint256' },
              { name: 'y', type: 'uint256' },
            ],
          },
          { name: 'b', type: 'address' },
        ]),
        'f',
        'b',
      ),
    ).toBe(64n)
  })

  test('nested static tuples flatten transitively', () => {
    expect(
      offsetOf(
        fn([
          {
            name: 'a',
            type: 'tuple',
            components: [
              { name: 'x', type: 'uint256' },
              {
                name: 'inner',
                type: 'tuple',
                components: [
                  { name: 'p', type: 'uint256' },
                  { name: 'q', type: 'bool' },
                ],
              },
            ],
          },
          { name: 'b', type: 'address' },
        ]),
        'f',
        'b',
      ),
    ).toBe(96n)
  })

  test('fixed-size array of static tuples multiplies the flattened size', () => {
    // (uint256,uint256)[2] = 2 * 2 words = 4 words.
    expect(
      offsetOf(
        fn([
          {
            name: 'a',
            type: 'tuple[2]',
            components: [
              { name: 'x', type: 'uint256' },
              { name: 'y', type: 'uint256' },
            ],
          },
          { name: 'b', type: 'address' },
        ]),
        'f',
        'b',
      ),
    ).toBe(128n)
  })

  test('dynamic params preceding still occupy exactly one pointer word', () => {
    for (const type of ['bytes', 'string', 'uint256[]', 'address[]']) {
      expect(
        offsetOf(
          fn([
            { name: 'a', type },
            { name: 'b', type: 'address' },
          ]),
          'f',
          'b',
        ),
      ).toBe(32n)
    }
  })

  test('a tuple containing a dynamic member is a pointer, not flattened', () => {
    // (uint256, bytes) is dynamic overall → one pointer word, NOT two words.
    expect(
      offsetOf(
        fn([
          {
            name: 'a',
            type: 'tuple',
            components: [
              { name: 'x', type: 'uint256' },
              { name: 'blob', type: 'bytes' },
            ],
          },
          { name: 'b', type: 'address' },
        ]),
        'f',
        'b',
      ),
    ).toBe(32n)
  })

  test('a fixed array of dynamic tuples is a pointer, not flattened', () => {
    expect(
      offsetOf(
        fn([
          {
            name: 'a',
            type: 'tuple[2]',
            components: [
              { name: 'x', type: 'uint256' },
              { name: 'blob', type: 'bytes' },
            ],
          },
          { name: 'b', type: 'address' },
        ]),
        'f',
        'b',
      ),
    ).toBe(32n)
  })

  test('offsets accumulate across a mixed run of preceding params', () => {
    // uint256(1) + bytes-pointer(1) + uint256[2](2) + tuple(uint,bool)(2) = 6 words
    expect(
      offsetOf(
        fn([
          { name: 'a', type: 'uint256' },
          { name: 'b', type: 'bytes' },
          { name: 'c', type: 'uint256[2]' },
          {
            name: 'd',
            type: 'tuple',
            components: [
              { name: 'x', type: 'uint256' },
              { name: 'y', type: 'bool' },
            ],
          },
          { name: 'e', type: 'address' },
        ]),
        'f',
        'e',
      ),
    ).toBe(192n)
  })

  test('the multi-word param itself is still rejected, not mis-scoped', () => {
    expect(() =>
      offsetOf(fn([{ name: 'a', type: 'uint256[3]' }]), 'f', 'a'),
    ).toThrow(/dynamic type/)
  })
})

describe('resolvePermission — inclusive { min, max } bounds', () => {
  const boundedAbi = [
    {
      type: 'function',
      name: 'stake',
      inputs: [{ name: 'amount', type: 'uint256' }],
      outputs: [],
      stateMutability: 'nonpayable',
    },
  ] as const

  test('compiles to AND(>= min, <= max) on one offset', () => {
    const actions = resolvePermission({
      abi: boundedAbi,
      address: USDC,
      functions: { stake: { params: { amount: { min: 10n, max: 100n } } } },
    })
    const policy = actions[0].policies![0]
    // Two rules on a single param cannot be expressed by the flat
    // universal-action shape, so this must escalate to arg-policy.
    expect(policy.type).toBe('arg-policy')
    if (policy.type !== 'arg-policy') throw new Error('wrong type')
    const expr = policy.expression
    if (expr.type !== 'and') throw new Error('expected AND')
    if (expr.left.type !== 'rule' || expr.right.type !== 'rule') {
      throw new Error('expected rule leaves')
    }
    expect(expr.left.rule).toMatchObject({
      condition: 'greaterThanOrEqual',
      calldataOffset: 0n,
      referenceValue: 10n,
    })
    expect(expr.right.rule).toMatchObject({
      condition: 'lessThanOrEqual',
      calldataOffset: 0n,
      referenceValue: 100n,
    })
  })

  test('min === max degenerates to an exact-value window, not an error', () => {
    const actions = resolvePermission({
      abi: boundedAbi,
      address: USDC,
      functions: { stake: { params: { amount: { min: 42n, max: 42n } } } },
    })
    expect(actions[0].policies![0].type).toBe('arg-policy')
  })

  test('zero-width lower bound of 0 is honoured, not treated as absent', () => {
    const actions = resolvePermission({
      abi: boundedAbi,
      address: USDC,
      functions: { stake: { params: { amount: { min: 0n, max: 5n } } } },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'arg-policy') throw new Error('wrong type')
    const expr = policy.expression
    if (expr.type !== 'and' || expr.left.type !== 'rule') {
      throw new Error('expected AND of rules')
    }
    expect(expr.left.rule.referenceValue).toBe(0n)
  })

  test('usageLimit rides on exactly one leaf, so calls are not double-counted', () => {
    const actions = resolvePermission({
      abi: boundedAbi,
      address: USDC,
      functions: {
        stake: { params: { amount: { min: 1n, max: 10n, usageLimit: 50n } } },
      },
    })
    const policy = actions[0].policies![0]
    if (policy.type !== 'arg-policy') throw new Error('wrong type')
    const expr = policy.expression
    if (expr.type !== 'and') throw new Error('expected AND')
    if (expr.left.type !== 'rule' || expr.right.type !== 'rule') {
      throw new Error('expected rule leaves')
    }
    expect(expr.left.rule.usageLimit).toBe(50n)
    expect(expr.right.rule.usageLimit).toBeUndefined()
  })

  test('throws when min > max — no value could ever satisfy it', () => {
    expect(() =>
      resolvePermission({
        abi: boundedAbi,
        address: USDC,
        functions: { stake: { params: { amount: { min: 100n, max: 10n } } } },
      }),
    ).toThrow(/greater than/)
  })

  test('throws when only one bound is supplied', () => {
    for (const partial of [{ min: 1n }, { max: 1n }]) {
      expect(() =>
        resolvePermission({
          abi: boundedAbi,
          address: USDC,
          // Half-open bounds are a compile error; this exercises the runtime
          // backstop for callers arriving without type safety (plain JS, JSON).
          functions: { stake: { params: { amount: partial } } },
        }),
      ).toThrow(/both "min" and "max"/)
    }
  })

  test('mixing bounds with a plain condition on another param still ANDs', () => {
    const actions = resolvePermission({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: { condition: 'equal', value: RECIPIENT },
            amount: { min: 1n, max: 1000n },
          },
        },
      },
    })
    const policy = actions[0].policies![0]
    expect(policy.type).toBe('arg-policy')
  })

  test('bounds on an address param compare the padded word', () => {
    const actions = resolvePermission({
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: {
              min: '0x0000000000000000000000000000000000000001',
              max: '0xffffffffffffffffffffffffffffffffffffffff',
            },
          },
        },
      },
    })
    expect(actions[0].policies![0].type).toBe('arg-policy')
  })
})
