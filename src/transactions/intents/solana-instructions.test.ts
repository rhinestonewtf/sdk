import { describe, expect, test } from 'vitest'
import type { SolanaInstructionInput } from '../../chains/non-evm'
import { InvalidSolanaTransactionArtifactError } from '../../errors/execution'
import {
  normalizeSolanaAddressLookupTables,
  normalizeSolanaInstructions,
} from './solana-instructions'

const systemProgram = '11111111111111111111111111111111'
const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const jupiterProgram = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
const payer = 'DfBX7Po1bmnXt4GuEF3Eg5UYUHAjs9m5n8nbb9WUqgw2'
const payee = '9fTE4gQnweN345EGzy6jnXNFW8VryvZ8QwLZqgBubmMs'
const lookupTable = 'GAQFGfFMdW95AdrXoBsWmCoiqHiWfYCKYvvmkNAbDwZ4'

// source: Solana System program instruction layout — u32 LE discriminant 2
// (Transfer) followed by a u64 LE lamport amount, here 1_000_000.
const transferData = Uint8Array.from([2, 0, 0, 0, 64, 66, 15, 0, 0, 0, 0, 0])

/** A `@solana/web3.js` `TransactionInstruction`, as its fields are named. */
function web3Instruction(): SolanaInstructionInput {
  const publicKey = (value: string) => ({ toBase58: () => value })
  return {
    programId: publicKey(systemProgram),
    keys: [
      { pubkey: publicKey(payer), isSigner: true, isWritable: true },
      { pubkey: publicKey(payee), isSigner: false, isWritable: true },
    ],
    data: transferData,
  }
}

// Shaped like a Jupiter `/swap-instructions` `swapInstruction` entry: base58
// strings and base64 data, taken verbatim from the JSON response.
const jupiterInstruction = {
  programId: jupiterProgram,
  accounts: [
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: false },
    { pubkey: payee, isSigner: false, isWritable: true },
  ],
  data: 'wSCbM0HWnIEAAAAAZAABQEIPAAAAAAA1QQ8AAAAAADIAAA==',
} as const

function instruction(overrides: Record<string, unknown> = {}) {
  return {
    programId: systemProgram,
    accounts: [{ pubkey: payer, isSigner: true, isWritable: true }],
    data: 'AQID',
    ...overrides,
  } as unknown as SolanaInstructionInput
}

describe('normalizeSolanaInstructions', () => {
  test('passes wire JSON through unchanged', () => {
    expect(normalizeSolanaInstructions([jupiterInstruction])).toEqual([
      jupiterInstruction,
    ])
  })

  test('normalizes a web3.js instruction to the wire shape', () => {
    expect(normalizeSolanaInstructions([web3Instruction()])).toEqual([
      {
        programId: systemProgram,
        accounts: [
          { pubkey: payer, isSigner: true, isWritable: true },
          { pubkey: payee, isSigner: false, isWritable: true },
        ],
        data: Buffer.from(transferData).toString('base64'),
      },
    ])
  })

  test('accepts empty instruction data', () => {
    expect(
      normalizeSolanaInstructions([instruction({ data: '' })])[0]?.data,
    ).toBe('')
    expect(
      normalizeSolanaInstructions([instruction({ data: new Uint8Array() })])[0]
        ?.data,
    ).toBe('')
  })

  test('preserves order and account metadata verbatim', () => {
    const normalized = normalizeSolanaInstructions([
      web3Instruction(),
      jupiterInstruction,
    ])
    expect(normalized.map((entry) => entry.programId)).toEqual([
      systemProgram,
      jupiterProgram,
    ])
    expect(normalized[1]?.accounts).toEqual(jupiterInstruction.accounts)
  })

  test('deep-freezes the result so a reused input cannot alter it', () => {
    const normalized = normalizeSolanaInstructions([jupiterInstruction])
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(Object.isFrozen(normalized[0])).toBe(true)
    expect(Object.isFrozen(normalized[0]?.accounts[0])).toBe(true)
  })

  test.each([
    ['no instructions', []],
    [
      'more than 32 instructions',
      Array.from({ length: 33 }, () => instruction()),
    ],
    [
      'more than 64 accounts in one instruction',
      [
        instruction({
          accounts: Array.from({ length: 65 }, () => ({
            pubkey: payer,
            isSigner: false,
            isWritable: false,
          })),
        }),
      ],
    ],
    [
      'more than 1232 bytes of instruction data',
      [instruction({ data: new Uint8Array(1233) })],
    ],
    ['a non-base58 program id', [instruction({ programId: 'not-base58' })]],
    ['a program id that is not 32 bytes', [instruction({ programId: '1111' })]],
    [
      'a non-base58 account',
      [
        instruction({
          accounts: [{ pubkey: '0x00', isSigner: false, isWritable: false }],
        }),
      ],
    ],
    [
      'a non-boolean signer flag',
      [
        instruction({
          accounts: [{ pubkey: payer, isSigner: 'yes', isWritable: false }],
        }),
      ],
    ],
    ['url-safe base64 data', [instruction({ data: 'a-b_' })]],
    ['whitespace in base64 data', [instruction({ data: 'AQ ID' })]],
    [
      'an @solana/kit instruction',
      [
        {
          programAddress: systemProgram,
          accounts: [{ address: payer, role: 3 }],
          data: new Uint8Array([1]),
        },
      ],
    ],
    ['a non-object entry', ['instruction']],
    [
      'a non-object account entry',
      [instruction({ accounts: ['not-an-account'] })],
    ],
  ])('refuses %s', (_label, input) => {
    expect(() =>
      normalizeSolanaInstructions(input as readonly SolanaInstructionInput[]),
    ).toThrow(InvalidSolanaTransactionArtifactError)
  })

  test('names the accepted forms when the shape is unrecognized', () => {
    expect(() =>
      normalizeSolanaInstructions([
        { programAddress: systemProgram } as unknown as SolanaInstructionInput,
      ]),
    ).toThrow(/@solana\/web3\.js/)
  })
})

describe('normalizeSolanaAddressLookupTables', () => {
  test('preserves order', () => {
    expect(normalizeSolanaAddressLookupTables([lookupTable, payer])).toEqual([
      lookupTable,
      payer,
    ])
  })

  test('omits an absent or empty table set', () => {
    expect(normalizeSolanaAddressLookupTables(undefined)).toBeUndefined()
    expect(normalizeSolanaAddressLookupTables([])).toBeUndefined()
  })

  test.each([
    ['more than 8 tables', Array.from({ length: 9 }, () => lookupTable)],
    ['a non-base58 table', ['not-base58']],
    ['a value that is not an array', lookupTable],
  ])('refuses %s', (_label, input) => {
    expect(() =>
      normalizeSolanaAddressLookupTables(input as readonly string[]),
    ).toThrow(InvalidSolanaTransactionArtifactError)
  })
})
