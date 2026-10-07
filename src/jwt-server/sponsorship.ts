import type { Address, Hex } from 'viem'
import { chainIdFromCaip2 } from '../chains/caip2'

export class SponsorshipDeniedError extends Error {
  constructor() {
    super('Sponsorship denied')
    this.name = 'SponsorshipDeniedError'
  }
}

type MaybeAsync<T> = T | Promise<T>

/**
 * Sponsorship policy checks over an intent's approval input. Every filter
 * reads the same values from each accepted approval input: the
 * `sdk-3.0.0-caucasus` input current SDKs send, the identical
 * `sdk-caucasus-singular-2026-09-v1` input of earlier v3 snapshots, and the
 * unversioned legacy input of v2 and older clients. Any other
 * `contractVersion` is refused.
 */
export interface SponsorshipFilter {
  /** The destination chain, by the SDK's numeric chain id. */
  chain?: (chain: { id: number }) => MaybeAsync<boolean>
  /** The account's EVM address, or its Swig wallet when it has no EVM entry. */
  account?: (address: Address) => MaybeAsync<boolean>
  /** The destination calls: EVM `execution.calls`, or HyperCore `settlement.calls`. */
  calls?: (
    calls: { to: Address; value: bigint; data: Hex }[],
  ) => MaybeAsync<boolean>
}

interface ParsedIntentInput {
  chain: { id: number }
  account: Address
  calls: { to: Address; value: bigint; data: Hex }[]
}

// The interim singular-v1 identifier stays accepted for earlier v3 snapshots
// until they drain.
const SINGULAR_CONTRACTS: readonly unknown[] = [
  'sdk-3.0.0-caucasus',
  'sdk-caucasus-singular-2026-09-v1',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCalls(
  executions: unknown,
  field: string,
): ParsedIntentInput['calls'] {
  if (!Array.isArray(executions)) {
    throw new Error(`intentInput.${field} must be an array`)
  }
  return executions.map(
    (exec: { to: string; value: string | number; data: string }) => ({
      to: exec.to as Address,
      value: BigInt(exec.value),
      data: exec.data as Hex,
    }),
  )
}

function parseLegacyIntentInput(
  input: Record<string, unknown>,
): ParsedIntentInput {
  const chainId = input.destinationChainId
  if (typeof chainId !== 'number') {
    throw new Error('intentInput.destinationChainId must be a number')
  }

  const account = input.account
  if (!isRecord(account)) {
    throw new Error('intentInput.account must be a non-null object')
  }
  const address = account.address
  if (typeof address !== 'string') {
    throw new Error('intentInput.account.address must be a string')
  }

  return {
    chain: { id: chainId },
    account: address as Address,
    calls: parseCalls(input.destinationExecutions, 'destinationExecutions'),
  }
}

function parseSingularIntentInput(
  input: Record<string, unknown>,
): ParsedIntentInput {
  const destination = input.destination
  if (!isRecord(destination)) {
    throw new Error('intentInput.destination must be a non-null object')
  }
  const chainId =
    typeof destination.chainId === 'string'
      ? chainIdFromCaip2(destination.chainId)
      : undefined
  if (chainId === undefined) {
    throw new Error('intentInput.destination.chainId must be a known CAIP-2 id')
  }

  const account = input.account
  if (!isRecord(account)) {
    throw new Error('intentInput.account must be a non-null object')
  }
  const entry = isRecord(account.evm)
    ? account.evm
    : isRecord(account.svm)
      ? account.svm
      : undefined
  if (!entry || typeof entry.address !== 'string') {
    throw new Error(
      'intentInput.account must carry an evm or svm entry with an address',
    )
  }

  const execution = isRecord(destination.execution)
    ? destination.vm === 'hypercore'
      ? destination.execution.settlement
      : destination.vm === 'evm'
        ? destination.execution
        : undefined
    : undefined
  const calls = isRecord(execution)
    ? parseCalls(execution.calls, 'destination.execution.calls')
    : []

  return { chain: { id: chainId }, account: entry.address as Address, calls }
}

function parseIntentInput(intentInput: unknown): ParsedIntentInput {
  if (!isRecord(intentInput)) {
    throw new Error('intentInput must be a non-null object')
  }
  if (!Object.hasOwn(intentInput, 'contractVersion')) {
    return parseLegacyIntentInput(intentInput)
  }
  if (!SINGULAR_CONTRACTS.includes(intentInput.contractVersion)) {
    throw new Error(
      `intentInput.contractVersion ${JSON.stringify(intentInput.contractVersion)} is not supported`,
    )
  }
  return parseSingularIntentInput(intentInput)
}

export async function shouldSponsor(
  intentInput: unknown,
  filters: SponsorshipFilter,
): Promise<boolean> {
  const parsed = parseIntentInput(intentInput)

  if (filters.chain && !(await filters.chain(parsed.chain))) {
    return false
  }
  if (filters.account && !(await filters.account(parsed.account))) {
    return false
  }
  if (filters.calls && !(await filters.calls(parsed.calls))) {
    return false
  }

  return true
}
