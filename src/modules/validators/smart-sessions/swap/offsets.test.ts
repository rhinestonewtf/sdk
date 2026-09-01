import { type Address, encodeFunctionData, erc20Abi, slice } from 'viem'
import { describe, expect, test } from 'vitest'
import { swapperAbi } from './rhinestone'
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
