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
import { satisfiesRules as holds } from '../../../../../test/utils/policy-rules'
import {
  OFT_CHAINS,
  OFT_SEND_SELECTOR,
  oftAbi,
  oftAdapter,
  SEND,
  scopeOft,
} from './oft'

const USDT0_ARB = OFT_CHAINS[42161].token
const USDT0_OP = OFT_CHAINS[10].token
const USDT0_PLASMA = OFT_CHAINS[9745].token
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address

function send(
  overrides: Partial<{
    eid: number
    to: Address
    amount: bigint
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
        minAmountLD: 99n,
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
  target: oftAdapter(42161),
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
      refund: ACCOUNT,
    })
    expect(word(calldata, SEND.sendParamPointer)).toBe(0x80n)
    expect(word(calldata, SEND.lzTokenFee)).toBe(0n)
    expect(word(calldata, SEND.refundAddress)).toBe(BigInt(ACCOUNT))
    expect(word(calldata, SEND.dstEid)).toBe(30383n)
    expect(word(calldata, SEND.to)).toBe(BigInt(OTHER))
    expect(word(calldata, SEND.amountLD)).toBe(7n)
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

  test('refuses a re-laid-out tuple that puts a decoy at the pinned offsets', () => {
    // The real tuple moved one word further; the pinned offsets now read a
    // copy of the canonical fields while the decoder follows the pointer.
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

  test('the cap is cumulative', () => {
    expect(holds(action, send({ amount: 60n }), 50n)).toBe(false)
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

  test('every bundled address is valid', () => {
    for (const { adapter, token } of Object.values(OFT_CHAINS)) {
      expect(isAddress(adapter)).toBe(true)
      expect(isAddress(token)).toBe(true)
    }
  })
})
