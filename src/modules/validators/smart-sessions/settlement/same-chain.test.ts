import {
  type Abi,
  type Address,
  encodeFunctionData,
  erc20Abi,
  toFunctionSelector,
} from 'viem'
import { describe, expect, test } from 'vitest'
import { satisfiesRules as holds } from '../../../../../test/utils/policy-rules'
import { namedParamOffsets } from '../../permissions'
import { swapperAbi, swapperAddresses } from '../swap/rhinestone'
import {
  SWAPPER_OUTPUT_BOUND_OFFSET,
  scopeSameChain,
  withRule,
} from './same-chain'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const WETH = '0x4200000000000000000000000000000000000006' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const THIRD = '0x3333333333333333333333333333333333333333' as Address
const TRANSFER = toFunctionSelector('transfer(address,uint256)')

const base = {
  chainId: 8453,
  environment: 'production',
  account: ACCOUNT,
  sourceTokens: [USDC],
  destinations: [{ chainId: 8453, token: USDC, recipient: OTHER }],
  cap: 100n,
} as const

const transfer = (to: Address, amount = 100n) =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amount],
  })

describe('scopeSameChain', () => {
  describe('same token: a pinned transfer', () => {
    const { actions, permissions } = scopeSameChain(base)
    const [action] = actions

    test('is one transfer on the token and nothing else', () => {
      expect(actions).toHaveLength(1)
      expect(permissions).toEqual([])
      expect(action.target).toBe(USDC)
      expect(action.selector).toBe(TRANSFER)
    })

    test('admits the transfer to the recipient within the cap', () => {
      expect(holds(action, transfer(OTHER))).toBe(true)
    })

    test.each([
      ['another recipient', transfer(THIRD)],
      ['an amount over the cap', transfer(OTHER, 101n)],
    ])('refuses %s', (_, calldata) => {
      expect(holds(action, calldata)).toBe(false)
    })

    test('the cap is cumulative', () => {
      expect(holds(action, transfer(OTHER, 60n), 50n)).toBe(false)
    })

    test('several recipients are an OR, with or without a cap', () => {
      for (const cap of [100n, undefined]) {
        const [several] = scopeSameChain({
          ...base,
          cap,
          destinations: [
            { chainId: 8453, token: USDC, recipient: OTHER },
            { chainId: 8453, token: USDC, recipient: THIRD },
          ],
        }).actions
        expect(holds(several, transfer(OTHER))).toBe(true)
        expect(holds(several, transfer(THIRD))).toBe(true)
        expect(holds(several, transfer(ACCOUNT))).toBe(false)
      }
    })

    test('an open recipient keeps the cap', () => {
      const [open] = scopeSameChain({
        ...base,
        destinations: [{ chainId: 8453, token: USDC }],
      }).actions
      expect(holds(open, transfer(THIRD))).toBe(true)
      expect(holds(open, transfer(THIRD, 101n))).toBe(false)
    })
  })

  describe('a different token: the Swapper swap', () => {
    const swap = scopeSameChain({
      ...base,
      destinations: [
        { chainId: 8453, token: WETH, recipient: OTHER, minAmount: 5n },
      ],
    })

    test('reuses the swap scope: an approve permission and the Swapper actions', () => {
      const swapper = swapperAddresses('production').swapper
      expect(swap.actions.map((a) => a.target)).toContain(swapper)
      expect(swap.permissions.map((p) => p.address)).toEqual([USDC])
    })

    const swapper = swapperAddresses('production').swapper
    const swapCall = (
      fn: 'swapExactIn' | 'swapExactOut',
      bound: bigint,
      o: Partial<{
        amount: bigint
        tokenOut: Address
        recipient: Address
      }> = {},
    ) =>
      encodeFunctionData({
        abi: swapperAbi,
        functionName: fn,
        // The quoted word (next to the bound) gets its own value, so a floor on
        // the wrong word cannot pass.
        args: [
          USDC,
          o.amount ?? 100n,
          o.tokenOut ?? WETH,
          bound,
          10n ** 18n,
          o.recipient ?? OTHER,
          0n,
          [],
        ],
      })

    test.each(['swapExactIn', 'swapExactOut'] as const)(
      '%s must bound its output at to.minAmount or above',
      (fn) => {
        const action = swap.actions.find(
          (a) =>
            a.target === swapper &&
            a.selector === swapCall(fn, 0n).slice(0, 10),
        )
        if (!action) throw new Error('no Swapper action')
        expect(holds(action, swapCall(fn, 5n))).toBe(true)
        expect(holds(action, swapCall(fn, 4n))).toBe(false)
        // The drain shape: accept nothing back and route the input away.
        expect(holds(action, swapCall(fn, 0n))).toBe(false)
        // The floor joins the swap pins rather than replacing them.
        expect(holds(action, swapCall(fn, 5n, { tokenOut: THIRD }))).toBe(false)
        expect(holds(action, swapCall(fn, 5n, { recipient: THIRD }))).toBe(
          false,
        )
        expect(holds(action, swapCall(fn, 5n, { amount: 101n }))).toBe(false)
      },
    )
  })

  test.each([
    [
      'a `to` leg on another chain',
      { destinations: [{ chainId: 42161, token: USDC, recipient: OTHER }] },
      'a `to` leg names chain 42161',
    ],
    [
      'more than one source token',
      { sourceTokens: [USDC, WETH] },
      'exactly one `from` token',
    ],
    [
      'a mix of transfer and swap legs',
      {
        destinations: [
          { chainId: 8453, token: USDC, recipient: OTHER },
          { chainId: 8453, token: WETH, recipient: OTHER },
        ],
      },
      'either transfers the `from` token or swaps it',
    ],
    [
      'a swap with an open recipient',
      { destinations: [{ chainId: 8453, token: WETH }] },
      'needs a concrete recipient',
    ],
    [
      'a swap without maxAmount',
      {
        cap: undefined,
        destinations: [
          { chainId: 8453, token: WETH, recipient: OTHER, minAmount: 5n },
        ],
      },
      'a SAME_CHAIN_IE swap needs maxAmount',
    ],
    [
      'a swap without to.minAmount',
      { destinations: [{ chainId: 8453, token: WETH, recipient: OTHER }] },
      'needs a positive `to.minAmount`',
    ],
    [
      'a to.minAmount on a transfer',
      {
        destinations: [
          { chainId: 8453, token: USDC, recipient: OTHER, minAmount: 1n },
        ],
      },
      'a SAME_CHAIN_IE transfer cannot enforce `to.minAmount`',
    ],
    [
      'a transfer to the account itself',
      { destinations: [{ chainId: 8453, token: USDC, recipient: ACCOUNT }] },
      'transfer to the account itself never settles',
    ],
    [
      'a native from token',
      { sourceTokens: ['0x0000000000000000000000000000000000000000'] },
      'a native `from` token is not supported',
    ],
    [
      'an open transfer recipient with no cap',
      { cap: undefined, destinations: [{ chainId: 8453, token: USDC }] },
      'needs maxAmount',
    ],
  ] as const)('refuses %s', (_, overrides, message) => {
    expect(() => scopeSameChain({ ...base, ...overrides })).toThrow(message)
  })
})

describe('the Swapper output floor', () => {
  test('sits at the same head word in both Swapper entrypoints', () => {
    const offsets = (fn: string) =>
      namedParamOffsets(swapperAbi as unknown as Abi, fn)
    expect(SWAPPER_OUTPUT_BOUND_OFFSET).toBe(96n)
    expect(offsets('swapExactOut').amountOut).toBe(SWAPPER_OUTPUT_BOUND_OFFSET)
  })

  test('every swap action targets the Swapper', () => {
    const swapper = swapperAddresses('production').swapper
    const { actions } = scopeSameChain({
      ...base,
      destinations: [
        { chainId: 8453, token: WETH, recipient: OTHER, minAmount: 5n },
      ],
    })
    expect(actions.length).toBeGreaterThan(0)
    for (const action of actions) expect(action.target).toBe(swapper)
  })

  describe('withRule joins the existing params policy', () => {
    const rule = {
      condition: 'equal',
      calldataOffset: 0n,
      referenceValue: 1n,
    } as const
    const floor = {
      condition: 'greaterThanOrEqual',
      calldataOffset: 96n,
      referenceValue: 5n,
    } as const

    test('appends to a universal-action policy', () => {
      expect(
        withRule({ type: 'universal-action', rules: [rule] }, floor),
      ).toEqual({ type: 'universal-action', rules: [rule, floor] })
    })

    test('moves a full universal-action policy onto an arg-policy AND', () => {
      const full = Array.from({ length: 16 }, () => rule)
      const merged = withRule(
        {
          type: 'universal-action',
          valueLimitPerUse: 0n,
          rules: full as [typeof rule, ...(typeof rule)[]],
        },
        floor,
      )
      expect(merged).toMatchObject({ type: 'arg-policy', valueLimitPerUse: 0n })
    })

    test('ANDs onto an arg-policy expression', () => {
      const expression = { type: 'rule', rule } as const
      expect(withRule({ type: 'arg-policy', expression }, floor)).toEqual({
        type: 'arg-policy',
        expression: {
          type: 'and',
          left: expression,
          right: { type: 'rule', rule: floor },
        },
      })
    })

    test('leaves other policies alone', () => {
      const timeFrame = {
        type: 'time-frame',
        validAfter: 1,
        validUntil: 2,
      } as const
      expect(withRule(timeFrame, floor)).toBe(timeFrame)
    })
  })
})
