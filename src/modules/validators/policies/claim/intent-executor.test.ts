import {
  type Address,
  type Chain,
  type Hex,
  size,
  slice,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem'
import { describe, expect, test } from 'vitest'
import type { IntentExecutorClaimPolicy } from '../../../../types'
import { CCTP_LAYER_ID, RELAY_LAYER_ID } from '../../../chain-abstraction'
import {
  buildIntentExecutorClaimPolicyCalldata,
  encodeIntentExecutorClaimPolicyInitData,
  type IntentExecutorClaimMessage,
} from './intent-executor'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CHAIN_ID = 8453
const chain = { id: CHAIN_ID } as unknown as Chain
const OTHER_CHAIN_ID = 1

const INTENT_EXECUTOR = '0x00000000005aD9ce1f5035FD62CA96CEf16AdAAF' as Address
// Mock infra wired in chain-abstraction.ts for the prod (non-dev) Relay layer.
const RELAY_ROUTER = '0x1111111111111111111111111111111111111111' as Address
const IE_ADAPTER = '0x2222222222222222222222222222222222222222' as Address

const TOKEN_A = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address // USDC
const TOKEN_B = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address // WETH
const RECIPIENT = '0x1234567890123456789012345678901234567890' as Address
const ACCOUNT = '0x9876543210987654321098765432109876543210' as Address

const EMPTY_OP = {
  vt: zeroHash,
  ops: [] as { to: Address; value: bigint; data: Hex }[],
}

/** Normalizes hex for case-insensitive equality (addresses are checksummed). */
const lc = (h: Hex) => h.toLowerCase() as Hex

// ---------------------------------------------------------------------------
// Init data
// ---------------------------------------------------------------------------

describe('encodeIntentExecutorClaimPolicyInitData', () => {
  test('encodes the base header with executor, default flags, and uncapped rate', () => {
    const policy: IntentExecutorClaimPolicy = { type: 'intent-executor-claim' }
    const data = encodeIntentExecutorClaimPolicyInitData(
      policy,
      chain,
      INTENT_EXECUTOR,
    )

    // [0:20] intentExecutor
    expect(lc(slice(data, 0, 20))).toBe(lc(INTENT_EXECUTOR))
    // [20] flags = 0
    expect(slice(data, 20, 21)).toBe('0x00')
    // [21:53] maxExchangeRate = 0
    expect(slice(data, 21, 53)).toBe(toHex(0n, { size: 32 }))
    // [53] gasTokenCount = 0
    expect(slice(data, 53, 54)).toBe('0x00')
    // [54] layerCount = 1 (Relay only in v1)
    expect(slice(data, 54, 55)).toBe('0x01')
  })

  test('sets requireGasRefund (bit0) and lockAccount (bit1) flags', () => {
    const both = encodeIntentExecutorClaimPolicyInitData(
      {
        type: 'intent-executor-claim',
        requireGasRefund: true,
        lockAccount: true,
      },
      chain,
      INTENT_EXECUTOR,
    )
    expect(slice(both, 20, 21)).toBe('0x03')

    const reqOnly = encodeIntentExecutorClaimPolicyInitData(
      { type: 'intent-executor-claim', requireGasRefund: true },
      chain,
      INTENT_EXECUTOR,
    )
    expect(slice(reqOnly, 20, 21)).toBe('0x01')

    const lockOnly = encodeIntentExecutorClaimPolicyInitData(
      { type: 'intent-executor-claim', lockAccount: true },
      chain,
      INTENT_EXECUTOR,
    )
    expect(slice(lockOnly, 20, 21)).toBe('0x02')
  })

  test('encodes maxExchangeRate as a uint256', () => {
    const data = encodeIntentExecutorClaimPolicyInitData(
      { type: 'intent-executor-claim', maxExchangeRate: 123456789n },
      chain,
      INTENT_EXECUTOR,
    )
    expect(slice(data, 21, 53)).toBe(toHex(123456789n, { size: 32 }))
  })

  test('only emits gas tokens for the session chain', () => {
    const data = encodeIntentExecutorClaimPolicyInitData(
      {
        type: 'intent-executor-claim',
        gasTokens: [
          { chainId: CHAIN_ID, token: TOKEN_A },
          { chainId: OTHER_CHAIN_ID, token: TOKEN_B }, // filtered out
        ],
      },
      chain,
      INTENT_EXECUTOR,
    )
    // [53] gasTokenCount = 1
    expect(slice(data, 53, 54)).toBe('0x01')
    // [54:74] the one in-chain token
    expect(lc(slice(data, 54, 74))).toBe(lc(TOKEN_A))
    // [74] layerCount
    expect(slice(data, 74, 75)).toBe('0x01')
  })

  test('builds the Relay layer + adapter config from tokensOut/recipients', () => {
    const data = encodeIntentExecutorClaimPolicyInitData(
      {
        type: 'intent-executor-claim',
        tokensOut: [
          { chainId: CHAIN_ID, token: TOKEN_A },
          { chainId: OTHER_CHAIN_ID, token: TOKEN_B }, // filtered
        ],
        recipients: [{ chainId: CHAIN_ID, recipient: RECIPIENT }],
      },
      chain,
      INTENT_EXECUTOR,
    )

    // base header: 20 + 1 + 32 + (1 gasTokenCount) = 54, gasTokens empty
    // layerCount at [54]
    expect(slice(data, 54, 55)).toBe('0x01')
    // layerId at [55:87]
    expect(lc(slice(data, 55, 87))).toBe(lc(RELAY_LAYER_ID))
    // configLen at [87:89] (uint16)
    const configLen = Number(slice(data, 87, 89))
    // relayRouter(20) + adapter(20) + recipientCount(1) + 1 recipient(20)
    //   + tokenCount(1) + 1 token(20) = 82
    expect(configLen).toBe(82)
    const config = slice(data, 89, 89 + configLen)
    expect(lc(slice(config, 0, 20))).toBe(lc(RELAY_ROUTER))
    expect(lc(slice(config, 20, 40))).toBe(lc(IE_ADAPTER))
    expect(slice(config, 40, 41)).toBe('0x01') // recipientCount
    expect(lc(slice(config, 41, 61))).toBe(lc(RECIPIENT))
    expect(slice(config, 61, 62)).toBe('0x01') // tokenCount
    expect(lc(slice(config, 62, 82))).toBe(lc(TOKEN_A))
    // blob ends exactly at the config tail
    expect(size(data)).toBe(89 + configLen)
  })

  test('uses dev infra addresses when useDevContracts is set', () => {
    const data = encodeIntentExecutorClaimPolicyInitData(
      { type: 'intent-executor-claim' },
      chain,
      INTENT_EXECUTOR,
      true,
    )
    // layerCount at [54], layerId [55:87], configLen [87:89], config [89:]
    const config = slice(data, 89)
    // dev Relay router / adapter from chain-abstraction.ts
    expect(lc(slice(config, 0, 20))).toBe(
      '0x3333333333333333333333333333333333333333',
    )
    expect(lc(slice(config, 20, 40))).toBe(
      '0x4444444444444444444444444444444444444444',
    )
  })
})

// ---------------------------------------------------------------------------
// Runtime data blob
// ---------------------------------------------------------------------------

const policy: IntentExecutorClaimPolicy = { type: 'intent-executor-claim' }

describe('buildIntentExecutorClaimPolicyCalldata', () => {
  test('encodes header + operation + hint tail with no gas refund', () => {
    const message: IntentExecutorClaimMessage = {
      account: ACCOUNT,
      nonce: 42n,
      op: EMPTY_OP,
    }
    const data = buildIntentExecutorClaimPolicyCalldata(policy, message, chain)

    // [0] variant = 0
    expect(slice(data, 0, 1)).toBe('0x00')
    // [1] hasGasRefund = 0
    expect(slice(data, 1, 2)).toBe('0x00')
    // [2:22] account
    expect(lc(slice(data, 2, 22))).toBe(lc(ACCOUNT))
    // [22:54] nonce
    expect(slice(data, 22, 54)).toBe(toHex(42n, { size: 32 }))

    // Operation begins at [54] (no gas-refund section). First word = vt.
    expect(slice(data, 54, 86)).toBe(zeroHash)
    // Next word = offset to ops array head == 0x40
    expect(slice(data, 86, 118)).toBe(toHex(0x40n, { size: 32 }))
    // Then ops.length == 0
    expect(slice(data, 118, 150)).toBe(toHex(0n, { size: 32 }))

    // Tail: callCount(0) then no hints.
    expect(slice(data, size(data) - 1)).toBe('0x00')
  })

  test('includes token, exchangeRate, AND overhead when a gas refund is present', () => {
    const message: IntentExecutorClaimMessage = {
      account: ACCOUNT,
      nonce: 7n,
      op: EMPTY_OP,
      gasRefund: { token: TOKEN_A, exchangeRate: 999n, overhead: 5n },
    }
    const data = buildIntentExecutorClaimPolicyCalldata(policy, message, chain)

    // [1] hasGasRefund = 1
    expect(slice(data, 1, 2)).toBe('0x01')
    // [54:74] token, [74:106] exchangeRate, [106:138] overhead
    expect(lc(slice(data, 54, 74))).toBe(lc(TOKEN_A))
    expect(slice(data, 74, 106)).toBe(toHex(999n, { size: 32 }))
    expect(slice(data, 106, 138)).toBe(toHex(5n, { size: 32 }))
    // Operation starts at [138]
    expect(slice(data, 138, 170)).toBe(zeroHash) // vt
  })

  test('treats a zero-address gas-refund token as "no gas refund"', () => {
    const message: IntentExecutorClaimMessage = {
      account: ACCOUNT,
      nonce: 1n,
      op: EMPTY_OP,
      gasRefund: { token: zeroAddress, exchangeRate: 0n, overhead: 0n },
    }
    const data = buildIntentExecutorClaimPolicyCalldata(policy, message, chain)
    expect(slice(data, 1, 2)).toBe('0x00')
    // Operation immediately follows the 54-byte header.
    expect(slice(data, 54, 86)).toBe(zeroHash)
  })

  test('appends a callCount header byte and one zero hint per call (single layer)', () => {
    const ops = [
      { to: RELAY_ROUTER, value: 0n, data: '0xcd6e13f7' as Hex },
      { to: TOKEN_A, value: 0n, data: '0x095ea7b3' as Hex },
    ]
    const message: IntentExecutorClaimMessage = {
      account: ACCOUNT,
      nonce: 3n,
      op: { vt: zeroHash, ops },
    }
    const data = buildIntentExecutorClaimPolicyCalldata(policy, message, chain)

    // Tail = callCount(uint8) + N hints. N = 2, all zeros (Relay-only install).
    const tail = slice(data, size(data) - 3)
    expect(tail).toBe('0x020000')
  })

  test('hint header byte equals the real op count (policy cross-checks it)', () => {
    const ops = Array.from({ length: 4 }, () => ({
      to: RELAY_ROUTER,
      value: 0n,
      data: '0xcd6e13f7' as Hex,
    }))
    const data = buildIntentExecutorClaimPolicyCalldata(
      policy,
      { account: ACCOUNT, nonce: 0n, op: { vt: zeroHash, ops } },
      chain,
    )
    const tail = slice(data, size(data) - 5)
    expect(slice(tail, 0, 1)).toBe('0x04') // callCount
    expect(slice(tail, 1)).toBe('0x00000000') // 4 zero hints
  })

  test('rejects more than 255 ops', () => {
    const ops = Array.from({ length: 256 }, () => ({
      to: RELAY_ROUTER,
      value: 0n,
      data: '0x' as Hex,
    }))
    expect(() =>
      buildIntentExecutorClaimPolicyCalldata(
        policy,
        { account: ACCOUNT, nonce: 0n, op: { vt: zeroHash, ops } },
        chain,
      ),
    ).toThrow()
  })

  test('encodes inner call data so the operation round-trips through the ABI head', () => {
    const ops = [{ to: RELAY_ROUTER, value: 1n, data: '0xdeadbeef' as Hex }]
    const data = buildIntentExecutorClaimPolicyCalldata(
      policy,
      { account: ACCOUNT, nonce: 0n, op: { vt: zeroHash, ops } },
      chain,
    )
    // Operation head at [54]: vt, then offset 0x40, then ops.length == 1.
    expect(slice(data, 54, 86)).toBe(zeroHash)
    expect(slice(data, 86, 118)).toBe(toHex(0x40n, { size: 32 }))
    expect(slice(data, 118, 150)).toBe(toHex(1n, { size: 32 }))
  })

  test('is deterministic', () => {
    const message: IntentExecutorClaimMessage = {
      account: ACCOUNT,
      nonce: 42n,
      op: EMPTY_OP,
      gasRefund: { token: TOKEN_A, exchangeRate: 10n, overhead: 1n },
    }
    expect(buildIntentExecutorClaimPolicyCalldata(policy, message, chain)).toBe(
      buildIntentExecutorClaimPolicyCalldata(policy, message, chain),
    )
  })
})

// A guard so the CCTP layer id constant stays referenced (and distinct).
test('layer ids are distinct', () => {
  expect(RELAY_LAYER_ID).not.toBe(CCTP_LAYER_ID)
})
