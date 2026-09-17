import { base64 } from '@scure/base'
import type {
  SolanaAccountMeta,
  SolanaInstruction,
  SolanaInstructionInput,
} from '../../chains/non-evm'
import { solanaAddress } from '../../chains/non-evm'
import { InvalidSolanaTransactionArtifactError } from '../../errors/execution'

// Mirrors the limits the orchestrator publishes on the quote request, so an
// oversized instruction set fails before a round trip.
const MAX_INSTRUCTIONS = 32
const MAX_ACCOUNTS_PER_INSTRUCTION = 64
const MAX_INSTRUCTION_DATA_BYTES = 1232
const MAX_ADDRESS_LOOKUP_TABLES = 8

const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const ACCEPTED_SHAPES =
  'an instruction must be either `{ programId, accounts, data }` with base58 addresses and base64 data, or a `@solana/web3.js` instruction with `programId`, `keys` and `data`'

function fail(message: string): never {
  throw new InvalidSolanaTransactionArtifactError(message)
}

function base58(value: unknown, label: string): string {
  if (typeof value === 'object' && value !== null) {
    const encode = (value as { toBase58?: unknown }).toBase58
    if (typeof encode === 'function') {
      return base58((encode as () => unknown).call(value), label)
    }
  }
  if (typeof value !== 'string') fail(`${label} must be a base58 address`)
  try {
    return solanaAddress(value)
  } catch {
    return fail(`${label} must be a base58 address`)
  }
}

function accountMeta(value: unknown, label: string): SolanaAccountMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
  const entry = value as Record<string, unknown>
  if (
    typeof entry.isSigner !== 'boolean' ||
    typeof entry.isWritable !== 'boolean'
  ) {
    fail(`${label}.isSigner and ${label}.isWritable must be booleans`)
  }
  return Object.freeze({
    pubkey: base58(entry.pubkey, `${label}.pubkey`),
    isSigner: entry.isSigner,
    isWritable: entry.isWritable,
  })
}

function instructionData(value: unknown, label: string): string {
  if (value instanceof Uint8Array) return base64.encode(value)
  if (typeof value !== 'string' || !BASE64.test(value)) {
    fail(`${label} must be base64-encoded instruction data`)
  }
  return value
}

function dataByteLength(value: string): number {
  if (value.length === 0) return 0
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

function instruction(value: unknown, label: string): SolanaInstruction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object; ${ACCEPTED_SHAPES}`)
  }
  const entry = value as Record<string, unknown>
  const accounts = 'keys' in entry ? entry.keys : entry.accounts
  if (!Array.isArray(accounts)) {
    fail(`${label} is not a recognized Solana instruction; ${ACCEPTED_SHAPES}`)
  }
  if (accounts.length > MAX_ACCOUNTS_PER_INSTRUCTION) {
    fail(
      `${label} references more than ${MAX_ACCOUNTS_PER_INSTRUCTION} accounts`,
    )
  }
  return Object.freeze({
    programId: base58(entry.programId, `${label}.programId`),
    accounts: Object.freeze(
      accounts.map((account, index) =>
        accountMeta(account, `${label}.accounts[${index}]`),
      ),
    ),
    data: instructionData(entry.data, `${label}.data`),
  })
}

/**
 * Normalizes caller-supplied instructions to the orchestrator's wire shape.
 * The result is JSON-round-trippable, so a prepared transaction can be
 * persisted and restored without a Solana runtime.
 */
export function normalizeSolanaInstructions(
  input: readonly SolanaInstructionInput[],
): readonly SolanaInstruction[] {
  if (!Array.isArray(input) || input.length === 0) {
    fail('a Solana instruction execution requires at least one instruction')
  }
  if (input.length > MAX_INSTRUCTIONS) {
    fail(`a Solana intent carries at most ${MAX_INSTRUCTIONS} instructions`)
  }
  const instructions = input.map((entry, index) =>
    instruction(entry, `instructions[${index}]`),
  )
  const bytes = instructions.reduce(
    (total, entry) => total + dataByteLength(entry.data),
    0,
  )
  if (bytes > MAX_INSTRUCTION_DATA_BYTES) {
    fail(
      `Solana instruction data must total at most ${MAX_INSTRUCTION_DATA_BYTES} bytes`,
    )
  }
  return Object.freeze(instructions)
}

/**
 * Normalizes the address lookup tables the instructions resolve accounts
 * through. Returns `undefined` when there are none, so the wire field is
 * omitted rather than sent empty.
 */
export function normalizeSolanaAddressLookupTables(
  input: readonly string[] | undefined,
): readonly string[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) {
    fail('addressLookupTables must be an array of base58 addresses')
  }
  if (input.length === 0) return undefined
  if (input.length > MAX_ADDRESS_LOOKUP_TABLES) {
    fail(
      `a Solana intent carries at most ${MAX_ADDRESS_LOOKUP_TABLES} address lookup tables`,
    )
  }
  return Object.freeze(
    input.map((table, index) => base58(table, `addressLookupTables[${index}]`)),
  )
}
