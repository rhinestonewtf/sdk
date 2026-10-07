import {
  type Address,
  concat,
  encodeFunctionData,
  type Hex,
  isAddress,
  maxUint256,
  pad,
  size,
  slice,
  toHex,
} from 'viem'
import { describe, expect, test } from 'vitest'
import { scopeOft as frozenScopeOft } from '../../../../../test/utils/oft-frozen'
import { satisfiesRules as holds } from '../../../../../test/utils/policy-rules'
import { SETTLEMENT_CATALOG } from '../../../../../test/utils/settlement-catalog'
import { OFT_SEND_SELECTOR, oftAbi, SEND, scopeOft } from './oft'

const USDT0_ARB = SETTLEMENT_CATALOG[42161].oft!.token
const USDT0_OP = SETTLEMENT_CATALOG[10].oft!.token
const USDT0_PLASMA = SETTLEMENT_CATALOG[9745].oft!.token
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address

function send(
  overrides: Partial<{
    eid: number
    to: Address
    amount: bigint
    minAmount: bigint
    extraOptions: Hex
    composeMsg: Hex
    oftCmd: Hex
    lzTokenFee: bigint
    refund: Address
  }> = {},
): Hex {
  return encodeFunctionData({
    abi: oftAbi,
    functionName: 'send',
    args: [
      {
        dstEid: overrides.eid ?? 30383,
        to: pad(overrides.to ?? ACCOUNT),
        amountLD: overrides.amount ?? 100n,
        minAmountLD: overrides.minAmount ?? 99n,
        extraOptions: overrides.extraOptions ?? '0x',
        composeMsg: overrides.composeMsg ?? '0x',
        oftCmd: overrides.oftCmd ?? '0x',
      },
      { nativeFee: 1n, lzTokenFee: overrides.lzTokenFee ?? 0n },
      overrides.refund ?? ACCOUNT,
    ],
  })
}

const word = (calldata: Hex, offset: bigint) =>
  BigInt(slice(calldata, 4 + Number(offset), 36 + Number(offset)))

const base = {
  chainId: 42161,
  settlement: SETTLEMENT_CATALOG,
  target: SETTLEMENT_CATALOG[42161].oft!.adapter,
  account: ACCOUNT,
  sourceTokens: [USDT0_ARB],
  timeFrame: [],
} as const

describe('OFT send offsets', () => {
  // The offsets are hand-derived for the canonical encoding; this pins them to
  // what viem actually emits, so an ABI change fails here rather than silently
  // moving a pin onto another word.
  test('each offset reads the field it names', () => {
    const calldata = send({
      eid: 30383,
      to: OTHER,
      amount: 7n,
      minAmount: 6n,
      refund: ACCOUNT,
      lzTokenFee: 9n,
    })
    expect(word(calldata, SEND.sendParamPointer)).toBe(0x80n)
    expect(word(calldata, SEND.lzTokenFee)).toBe(9n)
    expect(word(calldata, SEND.refundAddress)).toBe(BigInt(ACCOUNT))
    expect(word(calldata, SEND.dstEid)).toBe(30383n)
    expect(word(calldata, SEND.to)).toBe(BigInt(OTHER))
    expect(word(calldata, SEND.amountLD)).toBe(7n)
    expect(word(calldata, SEND.minAmountLD)).toBe(6n)
    expect(word(calldata, SEND.extraOptionsPointer)).toBe(0xe0n)
    expect(word(calldata, SEND.composeMsgPointer)).toBe(0x100n)
    expect(word(calldata, SEND.oftCmdPointer)).toBe(0x120n)
    expect(word(calldata, SEND.extraOptionsLength)).toBe(0n)
    expect(word(calldata, SEND.composeMsgLength)).toBe(0n)
    expect(word(calldata, SEND.oftCmdLength)).toBe(0n)
    expect(OFT_SEND_SELECTOR).toBe('0xc7c7f5b3')
  })
})

describe('scopeOft', () => {
  const action = scopeOft({
    ...base,
    destinations: [{ chainId: 9745, token: USDT0_PLASMA, recipient: ACCOUNT }],
    cap: 100n,
  })

  test('admits the send the orchestrator builds', () => {
    expect(holds(action, send())).toBe(true)
  })

  test.each([
    ['recipient', { to: OTHER }],
    ['destination eid', { eid: 30110 }],
    ['refund address', { refund: OTHER }],
    ['LayerZero token fee', { lzTokenFee: 1n }],
    // A native drop to any address, paid from the account's msg.value.
    [
      'extraOptions',
      { extraOptions: '0x0003010011010000000000000000000000000000ea60' as Hex },
    ],
    ['composeMsg', { composeMsg: '0x01' as Hex }],
    ['oftCmd', { oftCmd: '0x01' as Hex }],
    ['amount over the cap', { amount: 101n }],
  ] as const)('refuses a send with another %s', (_, overrides) => {
    expect(holds(action, send(overrides))).toBe(false)
  })

  test('refuses a send whose tuple pointer is not the canonical 0x80', () => {
    // With the pointer free, the decoder could read a tuple placed elsewhere
    // while the pinned offsets still hold canonical-looking words.
    const canonical = send()
    const args = slice(canonical, 4)
    const relaid = concat([
      OFT_SEND_SELECTOR,
      pad(toHex(0xa0n)),
      slice(args, 32),
    ])
    expect(holds(action, relaid)).toBe(false)
  })

  /** Replace one args word of the canonical send and append `tail`. */
  const rewrite = (offset: bigint, value: bigint, tail: Hex): Hex => {
    const args = slice(send(), 4)
    const at = Number(offset)
    return concat([
      OFT_SEND_SELECTOR,
      slice(args, 0, at),
      pad(toHex(value)),
      ...(at + 32 < size(args) ? [slice(args, at + 32)] : []),
      tail,
    ])
  }
  const NATIVE_DROP = pad('0x0003010011010000000000000000000000000000ea60', {
    dir: 'right',
  })

  test.each([
    ['extraOptions', SEND.extraOptionsLength],
    ['composeMsg', SEND.composeMsgLength],
    ['oftCmd', SEND.oftCmdLength],
  ] as const)('refuses a %s length that runs past the tuple', (_, offset) => {
    // Every pointer stays canonical; the length claims bytes appended after
    // the call.
    expect(holds(action, rewrite(offset, 0x80n, NATIVE_DROP))).toBe(false)
  })

  test.each([
    ['extraOptions', SEND.extraOptionsPointer],
    ['composeMsg', SEND.composeMsgPointer],
    ['oftCmd', SEND.oftCmdPointer],
  ] as const)('refuses a %s pointer aimed past the tuple', (_, offset) => {
    // The zero length words stay in place; the decoder follows the pointer to
    // a tail appended after the canonical tuple (7 head words + 3 lengths).
    const pastTuple = 0x140n
    expect(
      holds(
        action,
        rewrite(offset, pastTuple, concat([pad(toHex(22n)), NATIVE_DROP])),
      ),
    ).toBe(false)
  })

  test('refuses a zero-amount send, which still costs the LayerZero fee', () => {
    expect(holds(action, send({ amount: 0n }))).toBe(false)
  })

  test('sends once per session, so the burning transaction cannot repeat the fee', () => {
    // Any prior use of the one-shot pin refuses the send, whatever its amount.
    expect(holds(action, send({ amount: 1n }), 1n)).toBe(false)
  })

  test('the send may carry the LayerZero fee in msg.value', () => {
    expect(action.policies?.[0]).toMatchObject({ valueLimitPerUse: maxUint256 })
  })

  test('the validity window bounds the send', () => {
    const timeFrame = {
      type: 'time-frame',
      validAfter: 1,
      validUntil: 2,
    } as const
    const bounded = scopeOft({
      ...base,
      destinations: [
        { chainId: 9745, token: USDT0_PLASMA, recipient: ACCOUNT },
      ],
      timeFrame: [timeFrame],
    })
    expect(bounded.policies).toContainEqual(timeFrame)
  })

  test('pairs each recipient with its own destination', () => {
    const twoLegs = scopeOft({
      ...base,
      destinations: [
        { chainId: 9745, token: USDT0_PLASMA, recipient: ACCOUNT },
        { chainId: 10, token: USDT0_OP, recipient: OTHER },
      ],
    })
    expect(holds(twoLegs, send({ eid: 30383, to: ACCOUNT }))).toBe(true)
    expect(holds(twoLegs, send({ eid: 30111, to: OTHER }))).toBe(true)
    expect(holds(twoLegs, send({ eid: 30111, to: ACCOUNT }))).toBe(false)
    expect(twoLegs.policies?.[0]).toMatchObject({
      valueLimitPerUse: maxUint256,
    })
  })

  test('an open recipient still pins the destination', () => {
    const open = scopeOft({
      ...base,
      destinations: [{ chainId: 9745, token: USDT0_PLASMA }],
    })
    expect(holds(open, send({ to: OTHER }))).toBe(true)
    expect(holds(open, send({ eid: 30110 }))).toBe(false)
  })

  test.each([
    [
      'a chain the mesh does not reach',
      {
        destinations: [{ chainId: 8453, token: USDT0_ARB, recipient: ACCOUNT }],
      },
      'OFT does not route to chain 8453',
    ],
    [
      'a `from` token that is not USDT0',
      { sourceTokens: [OTHER] },
      'the `from` token on chain 42161',
    ],
    [
      'a `to` token that is not USDT0',
      { destinations: [{ chainId: 9745, token: OTHER, recipient: ACCOUNT }] },
      'the `to` token on chain 9745',
    ],
    [
      'more than one source token',
      { sourceTokens: [USDT0_ARB, OTHER] },
      'exactly one `from` token',
    ],
    ['no account for the refund', { account: undefined }, 'needs `account`'],
  ] as const)('refuses %s', (_, overrides, message) => {
    expect(() =>
      scopeOft({
        ...base,
        destinations: [
          { chainId: 9745, token: USDT0_PLASMA, recipient: ACCOUNT },
        ],
        ...overrides,
      }),
    ).toThrow(message)
  })

  test('refuses a chain the orchestrator serves no OFT block for', () => {
    const { oft: _, ...plasma } = SETTLEMENT_CATALOG[9745]
    expect(() =>
      scopeOft({
        ...base,
        settlement: { ...SETTLEMENT_CATALOG, 9745: plasma },
        destinations: [
          { chainId: 9745, token: USDT0_PLASMA, recipient: ACCOUNT },
        ],
      }),
    ).toThrow('OFT does not route to chain 9745')
  })

  test('every fixture address is valid', () => {
    for (const { oft } of Object.values(SETTLEMENT_CATALOG)) {
      if (!oft) continue
      expect(isAddress(oft.adapter)).toBe(true)
      expect(isAddress(oft.token)).toBe(true)
    }
  })
})

describe('scopeOft against the frozen builder', () => {
  const contexts = {
    'one leg, pinned recipient, capped': {
      destinations: [
        { chainId: 9745, token: USDT0_PLASMA, recipient: ACCOUNT },
      ],
      cap: 100n,
    },
    'one leg, open recipient, uncapped': {
      destinations: [{ chainId: 9745, token: USDT0_PLASMA }],
    },
    'two legs, capped': {
      destinations: [
        { chainId: 9745, token: USDT0_PLASMA, recipient: ACCOUNT },
        { chainId: 10, token: USDT0_OP, recipient: OTHER },
      ],
      cap: 100n,
    },
  } as const

  const calls = [
    ...[30383, 30111, 30110].flatMap((eid) =>
      [ACCOUNT, OTHER].flatMap((to) =>
        [0n, 1n, 60n, 100n, 101n].flatMap((amount) =>
          [0n, 1n, 50n, 60n, 80n, 100n, 101n].map((minAmount) =>
            send({ eid, to, amount, minAmount }),
          ),
        ),
      ),
    ),
    send({ refund: OTHER }),
    send({ lzTokenFee: 1n }),
    send({ composeMsg: '0x01' }),
  ]

  test.each(Object.entries(contexts))(
    '%s: unchanged without a floor',
    (_, ctx) => {
      const live = scopeOft({ ...base, ...ctx })
      const frozen = frozenScopeOft({ ...base, ...ctx })
      expect(live).toEqual(frozen)
      // The matrix must reach both verdicts, or agreement proves nothing.
      expect(calls.some((calldata) => holds(frozen, calldata))).toBe(true)
      expect(calls.some((calldata) => !holds(frozen, calldata))).toBe(true)
      for (const calldata of calls) {
        for (const used of [0n, 1n]) {
          expect(holds(live, calldata, used)).toBe(
            holds(frozen, calldata, used),
          )
        }
      }
    },
  )
})

describe('scopeOft with to.minAmount', () => {
  const floored = scopeOft({
    ...base,
    destinations: [
      {
        chainId: 9745,
        token: USDT0_PLASMA,
        recipient: ACCOUNT,
        minAmount: 60n,
      },
    ],
    cap: 100n,
  })

  test('admits a send whose minAmountLD meets the floor', () => {
    expect(holds(floored, send({ amount: 100n, minAmount: 99n }))).toBe(true)
    expect(holds(floored, send({ amount: 60n, minAmount: 60n }))).toBe(true)
  })

  test('refuses a send whose minAmountLD is below the floor', () => {
    // A key that zeroes minAmountLD accepts any fee or dust the OFT takes.
    expect(holds(floored, send({ minAmount: 0n }))).toBe(false)
    expect(holds(floored, send({ minAmount: 59n }))).toBe(false)
  })

  test('floors each leg on its own', () => {
    const twoLegs = scopeOft({
      ...base,
      destinations: [
        {
          chainId: 9745,
          token: USDT0_PLASMA,
          recipient: ACCOUNT,
          minAmount: 50n,
        },
        { chainId: 10, token: USDT0_OP, recipient: OTHER, minAmount: 80n },
      ],
    })
    expect(holds(twoLegs, send({ eid: 30383, minAmount: 60n }))).toBe(true)
    expect(
      holds(twoLegs, send({ eid: 30111, to: OTHER, minAmount: 60n })),
    ).toBe(false)
    expect(
      holds(twoLegs, send({ eid: 30111, to: OTHER, minAmount: 80n })),
    ).toBe(true)
  })

  test.each([
    ['a zero floor', 0n, 'must be positive'],
    ['a floor above the cap', 101n, 'above `maxAmount` admits no send'],
  ])('refuses %s', (_, minAmount, message) => {
    expect(() =>
      scopeOft({
        ...base,
        destinations: [
          { chainId: 9745, token: USDT0_PLASMA, recipient: ACCOUNT, minAmount },
        ],
        cap: 100n,
      }),
    ).toThrow(message)
  })

  describe('legs on one chain', () => {
    const legs =
      (
        a: { recipient?: Address; minAmount?: bigint },
        b: { recipient?: Address; minAmount?: bigint },
      ) =>
      () =>
        scopeOft({
          ...base,
          destinations: [
            { chainId: 9745, token: USDT0_PLASMA, ...a },
            { chainId: 9745, token: USDT0_PLASMA, ...b },
          ],
        })

    test.each([
      [
        'different floors',
        { recipient: ACCOUNT, minAmount: 60n },
        { recipient: ACCOUNT, minAmount: 80n },
      ],
      [
        'a floor beside none',
        { recipient: ACCOUNT, minAmount: 60n },
        { recipient: ACCOUNT },
      ],
      [
        'an open recipient beside a floored one',
        { recipient: ACCOUNT, minAmount: 60n },
        { minAmount: 50n },
      ],
    ] as const)('refuses two legs that admit one send with %s', (_, a, b) => {
      // The key would pick the looser branch.
      expect(legs(a, b)).toThrow('admit the same send but set different')
    })

    test('accepts legs whose sends cannot coincide, or whose floors agree', () => {
      expect(
        legs(
          { recipient: ACCOUNT, minAmount: 60n },
          { recipient: OTHER, minAmount: 80n },
        ),
      ).not.toThrow()
      expect(
        legs(
          { recipient: ACCOUNT, minAmount: 60n },
          { recipient: ACCOUNT, minAmount: 60n },
        ),
      ).not.toThrow()
      // Another chain is another eid, so the sends differ.
      expect(() =>
        scopeOft({
          ...base,
          destinations: [
            {
              chainId: 9745,
              token: USDT0_PLASMA,
              recipient: ACCOUNT,
              minAmount: 60n,
            },
            { chainId: 10, token: USDT0_OP, recipient: ACCOUNT },
          ],
        }),
      ).not.toThrow()
    })
  })

  describe('decimals', () => {
    /** The catalog with each listed token's served decimals replaced, or dropped when undefined. */
    const serving = (decimals: Record<number, number | undefined>) =>
      Object.fromEntries(
        Object.entries(SETTLEMENT_CATALOG).map(([id, chain]) => {
          const chainId = Number(id)
          if (!(chainId in decimals) || !chain.oft) return [id, chain]
          const others = (chain.usdStablecoins ?? []).filter(
            (t) => t.address !== chain.oft?.token,
          )
          const own = decimals[chainId]
          return [
            id,
            {
              ...chain,
              usdStablecoins:
                own === undefined
                  ? others
                  : [
                      ...others,
                      {
                        address: chain.oft.token,
                        symbol: 'USDT0',
                        decimals: own,
                      },
                    ],
            },
          ]
        }),
      )
    const floor = (settlement: ReturnType<typeof serving>) =>
      scopeOft({
        ...base,
        settlement,
        destinations: [
          {
            chainId: 9745,
            token: USDT0_PLASMA,
            recipient: ACCOUNT,
            minAmount: 60n,
          },
        ],
      })

    test('accepts a floor when both tokens are served with equal decimals', () => {
      expect(() => floor(serving({}))).not.toThrow()
      expect(() => floor(serving({ 42161: 18, 9745: 18 }))).not.toThrow()
    })

    test.each([
      ['more decimals on the destination', { 9745: 18 }],
      ['more decimals on the source', { 42161: 18 }],
      ['no served decimals for the destination', { 9745: undefined }],
      ['no served decimals for the source', { 42161: undefined }],
      [
        'no served decimals for either token',
        { 42161: undefined, 9745: undefined },
      ],
    ] as const)('refuses a floor with %s', (_, decimals) => {
      expect(() => floor(serving(decimals))).toThrow(
        'needs served, equal decimals',
      )
    })

    test('an unfloored send needs no served decimals', () => {
      expect(() =>
        scopeOft({
          ...base,
          settlement: serving({ 42161: undefined, 9745: undefined }),
          destinations: [
            { chainId: 9745, token: USDT0_PLASMA, recipient: ACCOUNT },
          ],
        }),
      ).not.toThrow()
    })
  })

  // Against the frozen builder a floor only narrows: it admits exactly the
  // frozen admissions whose minAmountLD meets the leg's floor.
  const floors: Record<number, bigint> = { 30383: 50n, 30111: 80n }
  const contexts = {
    'one leg': [{ chainId: 9745, token: USDT0_PLASMA, recipient: ACCOUNT }],
    'two legs': [
      { chainId: 9745, token: USDT0_PLASMA, recipient: ACCOUNT },
      { chainId: 10, token: USDT0_OP, recipient: OTHER },
    ],
  } as const
  const eidOf = { 9745: 30383, 10: 30111 } as const

  test.each(Object.entries(contexts))(
    '%s: a strict narrowing of the frozen builder',
    (_, legs) => {
      const frozen = frozenScopeOft({ ...base, destinations: legs, cap: 100n })
      const live = scopeOft({
        ...base,
        destinations: legs.map((leg) => ({
          ...leg,
          minAmount: floors[eidOf[leg.chainId]],
        })),
        cap: 100n,
      })
      let narrowed = 0
      for (const eid of [30383, 30111, 30110]) {
        for (const to of [ACCOUNT, OTHER]) {
          for (const amount of [0n, 1n, 60n, 100n, 101n]) {
            for (const minAmount of [0n, 1n, 49n, 50n, 79n, 80n, 100n]) {
              const calldata = send({ eid, to, amount, minAmount })
              const expected =
                holds(frozen, calldata) && minAmount >= (floors[eid] ?? 0n)
              expect(holds(live, calldata)).toBe(expected)
              if (holds(frozen, calldata) && !expected) narrowed++
            }
          }
        }
      }
      expect(narrowed).toBeGreaterThan(0)
    },
  )
})
