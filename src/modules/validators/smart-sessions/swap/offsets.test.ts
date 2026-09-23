import { type Address, encodeFunctionData, erc20Abi, slice } from 'viem'
import { describe, expect, test } from 'vitest'
import { FYND_ROUTERS, FYND_SWAP_SELECTOR, tychoRouterAbi } from './fynd'
import { swapperAbi, swapperAddresses } from './rhinestone'
import { allowanceHolderAbi, ZEROX_ALLOWANCE_HOLDER } from './zero-ex'

/**
 * The pinned offsets in `rhinestone.ts` and `zero-ex.ts` are byte positions into
 * calldata the SDK never builds — the orchestrator does. They were derived by
 * hand from a live trace, and nothing re-checks them, so a router ABI change
 * would silently move a pin onto unrelated bytes and the policy would go on
 * "passing" while binding nothing.
 *
 * These encode the real call shapes and assert each offset reads the field it
 * claims to. If an ABI moves, this fails instead of the guarantee quietly
 * evaporating.
 */
const SELL = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb' as Address
const BUY = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const RECIPIENT = '0x1111111111111111111111111111111111111111' as Address
const SETTLER = '0x5555555555555555555555555555555555555555' as Address

/** The 32-byte word an ArgPolicy rule at `offset` would read. */
function wordAt(calldata: `0x${string}`, offset: bigint): `0x${string}` {
  const start = 4 + Number(offset)
  return slice(calldata, start, start + 32)
}

function asAddress(word: `0x${string}`): Address {
  return `0x${word.slice(26)}` as Address
}

const approveCalldata = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'approve',
  args: [ZEROX_ALLOWANCE_HOLDER, 1000n],
})

const execCalldata = encodeFunctionData({
  abi: allowanceHolderAbi,
  functionName: 'exec',
  args: [SETTLER, SELL, 1000n, SETTLER, '0xdeadbeef'],
})

const swapperCalldata = encodeFunctionData({
  abi: swapperAbi,
  functionName: 'swapExactIn',
  args: [
    SELL,
    1000n,
    BUY,
    0n,
    0n,
    RECIPIENT,
    0n,
    [
      { target: SELL, value: 0n, data: approveCalldata },
      { target: ZEROX_ALLOWANCE_HOLDER, value: 0n, data: execCalldata },
    ],
  ],
})

describe('Swapper calls[] offsets match real encoded calldata', () => {
  test('the pinned ABI shape words are what the encoder actually emits', () => {
    expect(BigInt(wordAt(swapperCalldata, 224n))).toBe(256n) // array pointer
    expect(BigInt(wordAt(swapperCalldata, 256n))).toBe(2n) // length
    expect(BigInt(wordAt(swapperCalldata, 288n))).toBe(64n) // elem[0] pointer
    expect(BigInt(wordAt(swapperCalldata, 320n))).toBe(288n) // elem[1] pointer
  })

  test('the pinned call targets land on the real targets', () => {
    expect(asAddress(wordAt(swapperCalldata, 352n)).toLowerCase()).toBe(
      SELL.toLowerCase(),
    )
    expect(asAddress(wordAt(swapperCalldata, 576n)).toLowerCase()).toBe(
      ZEROX_ALLOWANCE_HOLDER.toLowerCase(),
    )
  })

  test('calls[0] is an approve whose spender sits at a fixed offset', () => {
    // Pinning the target alone leaves `calls[0].data` free, so the same call
    // could be `transfer(attacker, amountIn)`. These are the words that would
    // have to be pinned to rule that out.
    expect(BigInt(wordAt(swapperCalldata, 384n))).toBe(0n) // calls[0].value
    expect(BigInt(wordAt(swapperCalldata, 416n))).toBe(96n) // calls[0].data ptr
    expect(BigInt(wordAt(swapperCalldata, 448n))).toBe(68n) // calls[0].data len
    expect(asAddress(wordAt(swapperCalldata, 484n)).toLowerCase()).toBe(
      ZEROX_ALLOWANCE_HOLDER.toLowerCase(),
    ) // the approved spender
    // The word at 480 straddles the selector and the spender's leading bytes,
    // which is what distinguishes approve() from a same-shaped transfer().
    expect(wordAt(swapperCalldata, 480n).toLowerCase()).toBe(
      `0x095ea7b3${'00'.repeat(12)}${ZEROX_ALLOWANCE_HOLDER.slice(
        2,
        34,
      ).toLowerCase()}`,
    )
  })
})

describe('the nested exec inside calls[1] is at a fixed position too', () => {
  test('calls[1] carries an exec whose head words are addressable', () => {
    // calls[1] starts at 576; +32 value, +64 data pointer, +96 length, and the
    // blob itself at 704 — so exec's own head begins at 708, past its selector.
    expect(BigInt(wordAt(swapperCalldata, 608n))).toBe(0n) // calls[1].value
    expect(BigInt(wordAt(swapperCalldata, 640n))).toBe(96n) // calls[1].data ptr
    expect(asAddress(wordAt(swapperCalldata, 708n)).toLowerCase()).toBe(
      SETTLER.toLowerCase(),
    ) // nested exec operator
    expect(asAddress(wordAt(swapperCalldata, 740n)).toLowerCase()).toBe(
      SELL.toLowerCase(),
    ) // nested exec token
    expect(asAddress(wordAt(swapperCalldata, 804n)).toLowerCase()).toBe(
      SETTLER.toLowerCase(),
    ) // nested exec target
  })
})

describe('fynd singleSwap offsets match real encoded calldata', () => {
  const router = FYND_ROUTERS[9745]
  const swapper = swapperAddresses('production').swapper
  const singleSwap = (receiver: Address) =>
    encodeFunctionData({
      abi: tychoRouterAbi,
      functionName: 'singleSwap',
      args: [
        1000n,
        SELL,
        BUY,
        990n,
        980n,
        receiver,
        {
          clientFeeBps: 0,
          clientFeeReceiver: RECIPIENT,
          maxClientContribution: 0n,
          deadline: 0n,
          clientSignature: '0x',
        },
        '0xdeadbeef',
      ],
    })

  test('the ABI derives the selector TychoRouter V3 deploys', () => {
    expect(FYND_SWAP_SELECTOR).toBe('0x0c1a0ee7')
  })

  test('the direct call pins land on amountIn, the tokens and the receiver', () => {
    const calldata = singleSwap(RECIPIENT)
    expect(BigInt(wordAt(calldata, 0n))).toBe(1000n) // amountIn
    expect(asAddress(wordAt(calldata, 32n)).toLowerCase()).toBe(
      SELL.toLowerCase(),
    ) // tokenIn
    expect(asAddress(wordAt(calldata, 64n)).toLowerCase()).toBe(
      BUY.toLowerCase(),
    ) // tokenOut
    expect(asAddress(wordAt(calldata, 160n)).toLowerCase()).toBe(
      RECIPIENT.toLowerCase(),
    ) // receiver
  })

  test('the swap nested in calls[1] has its tokens and receiver at 740/772/868', () => {
    const wrapped = encodeFunctionData({
      abi: swapperAbi,
      functionName: 'swapExactIn',
      args: [
        SELL,
        1000n,
        BUY,
        0n,
        0n,
        RECIPIENT,
        0n,
        [
          {
            target: SELL,
            value: 0n,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: 'approve',
              args: [router, 1000n],
            }),
          },
          { target: router, value: 0n, data: singleSwap(swapper) },
        ],
      ],
    })
    expect(asAddress(wordAt(wrapped, 576n)).toLowerCase()).toBe(router)
    expect(BigInt(wordAt(wrapped, 640n))).toBe(96n) // calls[1].data ptr
    expect(asAddress(wordAt(wrapped, 740n)).toLowerCase()).toBe(
      SELL.toLowerCase(),
    ) // nested tokenIn
    expect(asAddress(wordAt(wrapped, 772n)).toLowerCase()).toBe(
      BUY.toLowerCase(),
    ) // nested tokenOut
    expect(asAddress(wordAt(wrapped, 868n)).toLowerCase()).toBe(
      swapper.toLowerCase(),
    ) // nested receiver
  })
})

describe('AllowanceHolder.exec offsets match real encoded calldata', () => {
  test('the head words are where the policy reads them', () => {
    expect(asAddress(wordAt(execCalldata, 0n)).toLowerCase()).toBe(
      SETTLER.toLowerCase(),
    ) // operator
    expect(asAddress(wordAt(execCalldata, 32n)).toLowerCase()).toBe(
      SELL.toLowerCase(),
    ) // token
    expect(BigInt(wordAt(execCalldata, 64n))).toBe(1000n) // amount
    expect(asAddress(wordAt(execCalldata, 96n)).toLowerCase()).toBe(
      SETTLER.toLowerCase(),
    ) // target
  })

  test('the data pointer holds the canonical tail the Settler pins assume', () => {
    // 196/228 are only recipient/buyToken while this word says 160.
    expect(BigInt(wordAt(execCalldata, 128n))).toBe(160n)
  })
})
