import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import {
  compactIntent,
  permit2Intent,
  singleChainIntent,
} from './__fixtures__/intents'
import { getIntentMessagesFromWasm, invalidateCache } from './loader'

const WASM_PATH = resolve(
  __dirname,
  '../../../crates/eip712-mapper/target/wasm32-unknown-unknown/release/eip712_mapper_viem.wasm',
)
const wasmBinary = readFileSync(WASM_PATH)
const WASM_URL = 'https://test.local/eip712_mapper.wasm'

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === WASM_URL) {
        return new Response(new Uint8Array(wasmBinary), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }),
  )
})

afterEach(() => {
  invalidateCache()
})

const ACCOUNT_ADDRESS = '0x7a07d9cc408dd92165900c302d31d914d26b3827'
// Exact contract addresses hardcoded in the WASM binary (prod build)
const COMPACT_ADDRESS = '0x00000000000000171ede64904551eedf3c6c9788'
const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3'
const INTENT_EXECUTOR_ADDRESS_PROD =
  '0x00000000005ad9ce1f5035fd62ca96cef16adaaf'
// keccak256(0xdeadbeef) — independently verified
const KECCAK_DEADBEEF =
  '0xd4fd4e189132273036449fc9e11198c739161b4c0116a9a2dccdfa1c492006f1'
// keccak256(0x) — keccak256 of empty bytes, well-known constant
const KECCAK_EMPTY =
  '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'

describe('WASM EIP-712 mapper', () => {
  describe('Compact mapper', () => {
    test('produces MultichainCompact typed data', async () => {
      const result = await getIntentMessagesFromWasm(
        {
          intentOp: compactIntent,
          context: {
            accountAddress: ACCOUNT_ADDRESS,
          },
        },
        WASM_URL,
      )

      expect(result.origin).toHaveLength(1)
      const td = result.origin[0]

      // Check domain with exact verifyingContract
      expect(td.domain).toMatchObject({
        name: 'The Compact',
        version: '1',
        chainId: 8453,
        verifyingContract: COMPACT_ADDRESS,
      })

      // Check primary type
      expect(td.primaryType).toBe('MultichainCompact')

      // Check message structure
      const msg = td.message as any
      expect(msg.sponsor).toBe(compactIntent.sponsor)
      expect(msg.nonce).toBe(12345n)
      expect(msg.expires).toBe(1700000000n)
      expect(msg.elements).toHaveLength(1)

      // Check element
      const elem = msg.elements[0]
      expect(elem.arbiter).toBe(compactIntent.elements[0].arbiter.toLowerCase())
      expect(elem.chainId).toBe(8453n)

      // Check commitments with exact lockTag and token values
      expect(elem.commitments).toHaveLength(1)
      // Fixture token ID = 0x000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913
      // lockTag = first 12 bytes = all zeros
      expect(elem.commitments[0].lockTag).toBe('0x000000000000000000000000')
      expect(elem.commitments[0].token).toBe(
        '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      )
      expect(elem.commitments[0].amount).toBe(1000000n)

      // Check mandate
      expect(elem.mandate.target.recipient).toBe(
        compactIntent.elements[0].mandate.recipient,
      )
      expect(elem.mandate.target.targetChain).toBe(8453n)
      expect(elem.mandate.target.fillExpiry).toBe(1700001000n)

      // Check q is exact keccak256 of encodedVal (0xdeadbeef)
      expect(elem.mandate.q).toBe(KECCAK_DEADBEEF)
    })
  })

  describe('Permit2 mapper', () => {
    test('produces PermitBatchWitnessTransferFrom typed data', async () => {
      const result = await getIntentMessagesFromWasm(
        {
          intentOp: permit2Intent,
          context: {
            accountAddress: ACCOUNT_ADDRESS,
          },
        },
        WASM_URL,
      )

      expect(result.origin).toHaveLength(1)
      const td = result.origin[0]

      // Check domain with exact verifyingContract
      expect(td.domain).toMatchObject({
        name: 'Permit2',
        chainId: 1,
        verifyingContract: PERMIT2_ADDRESS,
      })
      // Permit2 domain should NOT have a version key
      expect(td.domain).not.toHaveProperty('version')

      // Check primary type
      expect(td.primaryType).toBe('PermitBatchWitnessTransferFrom')

      // Check message
      const msg = td.message as any
      expect(msg.spender).toBe(permit2Intent.elements[0].arbiter)
      expect(msg.nonce).toBe(99999n)
      expect(msg.deadline).toBe(1700000000n)

      // Check permitted tokens
      expect(msg.permitted).toHaveLength(1)
      expect(msg.permitted[0].token).toBe(
        '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      )
      expect(msg.permitted[0].amount).toBe(2000000n)

      // Check mandate with exact q hash (keccak256 of empty bytes 0x)
      expect(msg.mandate.target.recipient).toBe(
        permit2Intent.elements[0].mandate.recipient,
      )
      expect(msg.mandate.q).toBe(KECCAK_EMPTY)
    })
  })

  describe('SingleChainOps mapper', () => {
    test('produces SingleChainOps typed data with gasRefund', async () => {
      const result = await getIntentMessagesFromWasm(
        {
          intentOp: singleChainIntent,
          context: {
            accountAddress: ACCOUNT_ADDRESS,
          },
        },
        WASM_URL,
      )

      expect(result.origin).toHaveLength(1)
      const td = result.origin[0]

      // Check domain — verifyingContract is now hardcoded in WASM (prod address)
      expect(td.domain).toMatchObject({
        name: 'IntentExecutor',
        version: 'v0.0.1',
        chainId: 8453,
        verifyingContract: INTENT_EXECUTOR_ADDRESS_PROD,
      })

      // Check primary type
      expect(td.primaryType).toBe('SingleChainOps')

      // Check message
      const msg = td.message as any
      expect(msg.account).toBe(ACCOUNT_ADDRESS)
      expect(msg.nonce).toBe(55555n)

      // Check op with exact vt from fixture
      expect(msg.op).toBeDefined()
      expect(msg.op.ops).toHaveLength(1)
      expect(msg.op.vt).toBe(
        '0x0203000000000000000000000000000000000000000000000000000000000000',
      )
      expect(msg.op.ops[0].to).toBe(
        '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      )

      // Check gasRefund with exact values
      expect(msg.gasRefund).toBeDefined()
      expect(msg.gasRefund.token).toBe(
        '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      )
      expect(msg.gasRefund.exchangeRate).toBe(1000000000000000000n)
      expect(msg.gasRefund.overhead).toBe(50000n)
    })
  })

  describe('multi-element intents', () => {
    test('compact with 2 elements produces origin array of length 2', async () => {
      const multiElementIntent = {
        ...compactIntent,
        elements: [compactIntent.elements[0], compactIntent.elements[0]],
      }

      const result = await getIntentMessagesFromWasm(
        {
          intentOp: multiElementIntent,
          context: { accountAddress: ACCOUNT_ADDRESS },
        },
        WASM_URL,
      )

      // Compact duplicates the typed data per element
      expect(result.origin).toHaveLength(2)
      // Both should be MultichainCompact
      expect(result.origin[0].primaryType).toBe('MultichainCompact')
      expect(result.origin[1].primaryType).toBe('MultichainCompact')
    })

    test('permit2 with 2 elements produces 2 independent typed data entries', async () => {
      const multiElementIntent = {
        ...permit2Intent,
        elements: [permit2Intent.elements[0], permit2Intent.elements[0]],
      }

      const result = await getIntentMessagesFromWasm(
        {
          intentOp: multiElementIntent,
          context: { accountAddress: ACCOUNT_ADDRESS },
        },
        WASM_URL,
      )

      expect(result.origin).toHaveLength(2)
      expect(result.origin[0].primaryType).toBe(
        'PermitBatchWitnessTransferFrom',
      )
      expect(result.origin[1].primaryType).toBe(
        'PermitBatchWitnessTransferFrom',
      )
    })

    test('single chain with 2 elements produces 2 independent typed data entries', async () => {
      const multiElementIntent = {
        ...singleChainIntent,
        elements: [
          singleChainIntent.elements[0],
          singleChainIntent.elements[0],
        ],
      }

      const result = await getIntentMessagesFromWasm(
        {
          intentOp: multiElementIntent,
          context: { accountAddress: ACCOUNT_ADDRESS },
        },
        WASM_URL,
      )

      expect(result.origin).toHaveLength(2)
      expect(result.origin[0].primaryType).toBe('SingleChainOps')
      expect(result.origin[1].primaryType).toBe('SingleChainOps')
    })

    test('destination is always the last origin entry', async () => {
      const multiElementIntent = {
        ...permit2Intent,
        elements: [permit2Intent.elements[0], permit2Intent.elements[0]],
      }

      const result = await getIntentMessagesFromWasm(
        {
          intentOp: multiElementIntent,
          context: { accountAddress: ACCOUNT_ADDRESS },
        },
        WASM_URL,
      )

      // destination should be the same reference as the last origin entry
      const lastOrigin = result.origin[result.origin.length - 1]
      expect(result.destination).toBe(lastOrigin)
    })
  })

  describe('deserialization', () => {
    test('numeric strings in message become BigInt', async () => {
      const result = await getIntentMessagesFromWasm(
        {
          intentOp: compactIntent,
          context: { accountAddress: ACCOUNT_ADDRESS },
        },
        WASM_URL,
      )

      const msg = result.origin[0].message as any
      expect(typeof msg.nonce).toBe('bigint')
      expect(typeof msg.expires).toBe('bigint')
    })

    test('hex strings remain as strings (not converted to BigInt)', async () => {
      const result = await getIntentMessagesFromWasm(
        {
          intentOp: compactIntent,
          context: { accountAddress: ACCOUNT_ADDRESS },
        },
        WASM_URL,
      )

      const msg = result.origin[0].message as any
      // Addresses and hex values should stay as strings
      expect(typeof msg.sponsor).toBe('string')
      expect(msg.sponsor).toMatch(/^0x[0-9a-f]+$/)
    })

    test('domain chainId stays as number (not BigInt)', async () => {
      const result = await getIntentMessagesFromWasm(
        {
          intentOp: compactIntent,
          context: { accountAddress: ACCOUNT_ADDRESS },
        },
        WASM_URL,
      )

      const td = result.origin[0]
      expect(typeof (td.domain as any).chainId).toBe('number')
    })
  })

  describe('WASM caching', () => {
    test('reuses cached instance for same URL', async () => {
      // First call
      await getIntentMessagesFromWasm(
        {
          intentOp: compactIntent,
          context: { accountAddress: ACCOUNT_ADDRESS },
        },
        WASM_URL,
      )

      const fetchCount1 = (fetch as any).mock.calls.length

      // Second call — should use cache, no new fetch
      await getIntentMessagesFromWasm(
        {
          intentOp: permit2Intent,
          context: { accountAddress: ACCOUNT_ADDRESS },
        },
        WASM_URL,
      )

      expect((fetch as any).mock.calls.length).toBe(fetchCount1)
    })
  })

  describe('error handling', () => {
    test('returns error for empty elements', async () => {
      const emptyIntent = {
        ...compactIntent,
        elements: [],
      }

      await expect(
        getIntentMessagesFromWasm(
          {
            intentOp: emptyIntent,
            context: {
              accountAddress: ACCOUNT_ADDRESS,
            },
          },
          WASM_URL,
        ),
      ).rejects.toThrow()
    })

    test('error message mentions empty elements', async () => {
      const emptyIntent = {
        ...compactIntent,
        elements: [],
      }

      await expect(
        getIntentMessagesFromWasm(
          {
            intentOp: emptyIntent,
            context: { accountAddress: ACCOUNT_ADDRESS },
          },
          WASM_URL,
        ),
      ).rejects.toThrow(/empty/)
    })
  })
})
