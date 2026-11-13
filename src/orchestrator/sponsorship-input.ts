import type { IntentInput } from './types'
import { blancQuoteRequest } from './wire-quote-request'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a Blanc sponsorship input object')
  }
  return value as JsonRecord
}

function numericChainId(value: unknown): number {
  if (typeof value !== 'string' || !/^eip155:(0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`Unsupported Blanc sponsorship chain ID: ${String(value)}`)
  }
  const chainId = Number(value.slice('eip155:'.length))
  if (!Number.isSafeInteger(chainId)) {
    throw new Error(`Unsafe Blanc sponsorship chain ID: ${value}`)
  }
  return chainId
}

function chainKeys(value: unknown): JsonRecord {
  return Object.fromEntries(
    Object.entries(record(value)).map(([chainId, entry]) => [
      numericChainId(chainId),
      entry,
    ]),
  )
}

function accessList(value: unknown): JsonRecord {
  const list = record(value)
  return {
    ...list,
    ...(list.chainIds !== undefined && {
      chainIds: (list.chainIds as unknown[]).map(numericChainId),
    }),
    ...(list.chainTokens !== undefined && {
      chainTokens: chainKeys(list.chainTokens),
    }),
    ...(list.chainTokenAmounts !== undefined && {
      chainTokenAmounts: chainKeys(list.chainTokenAmounts),
    }),
    ...(list.exclude !== undefined && { exclude: accessList(list.exclude) }),
  }
}

// sdk-2.16.2-blanc: project the transmitted JSON, not server-defaulted input.
// Keep unknown fields bound; the backend independently refuses unsupported shapes.
export function projectBlancSponsorshipInput(value: unknown): JsonRecord {
  const raw = record(value)
  const { destinationGasLimit, ...rest } = raw
  return {
    ...rest,
    destinationChainId: numericChainId(raw.destinationChainId),
    ...(destinationGasLimit !== undefined && {
      destinationGasUnits: destinationGasLimit,
    }),
    ...(raw.accountAccessList !== undefined && {
      accountAccessList: accessList(raw.accountAccessList),
    }),
    ...(raw.options !== undefined && {
      options: {
        ...record(raw.options),
        ...(record(raw.options).auxiliaryFunds !== undefined && {
          auxiliaryFunds: chainKeys(record(raw.options).auxiliaryFunds),
        }),
      },
    }),
    ...(raw.preClaimExecutions !== undefined && {
      preClaimExecutions: chainKeys(raw.preClaimExecutions),
    }),
  }
}

function assertFiniteNumbers(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Cannot canonicalise non-finite number')
  }
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) assertFiniteNumbers(entry)
  }
}

/** Accept the unchanged v1 callback input, including decimal-string amounts. */
export function normalizeBlancSponsorshipInput(
  intentInput: unknown,
): JsonRecord {
  // JSON turns non-finite numbers into null, including in fields the mapper drops.
  assertFiniteNumbers(intentInput)
  return projectBlancSponsorshipInput(
    JSON.parse(JSON.stringify(blancQuoteRequest(intentInput as IntentInput))),
  )
}
