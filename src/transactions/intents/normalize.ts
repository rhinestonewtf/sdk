import type { TypedDataDefinition, TypedDataParameter } from 'viem'
import { ValidationError } from '../../clients/orchestrator/errors'
import type { SigningRequest } from '../../clients/orchestrator/public'
import type {
  OrchestratorExecutionQuote,
  OrchestratorQuote,
} from '../../clients/orchestrator/types'

type TypedDataTypes = Record<string, readonly TypedDataParameter[]>

export function normalizeIntentTypedData(
  typedData: TypedDataDefinition,
): TypedDataDefinition {
  const types = typedData.types as TypedDataTypes
  return {
    ...typedData,
    message: normalizeTypedDataMessage(
      types,
      typedData.primaryType as string,
      typedData.message as Record<string, unknown>,
    ),
  } as TypedDataDefinition
}

// Normalizes the numeric values a JSON payload carries as strings into the
// bigints viem hashes with. The typed-data digest is unchanged by this.
function normalizeSigningRequest(request: SigningRequest): SigningRequest {
  return request.payload.kind === 'eip712'
    ? {
        ...request,
        payload: {
          ...request.payload,
          typedData: normalizeIntentTypedData(request.payload.typedData),
        },
      }
    : request
}

/**
 * Normalizes an execution route. An account-creation route is refused: it
 * carries no execution cost or signing requests, and reading it as one would
 * present a deployment as a spend.
 */
export function normalizeIntentQuote(
  quote: OrchestratorQuote,
): OrchestratorExecutionQuote {
  if (quote.purpose !== 'execution') {
    throw new ValidationError({
      message: `The orchestrator returned a ${String(quote.purpose)} route (${quote.intentId}) where an execution route was expected.`,
    })
  }
  return {
    ...quote,
    signingRequests: quote.signingRequests.map(normalizeSigningRequest),
  }
}

function normalizeTypedDataMessage(
  types: TypedDataTypes,
  primaryType: string,
  message: Record<string, unknown>,
): Record<string, unknown> {
  const fields = types[primaryType]
  if (!fields) return message
  return Object.fromEntries(
    Object.entries(message).map(([name, value]) => {
      const type = fields.find((field) => field.name === name)?.type
      return [name, type ? normalizeTypedDataValue(types, type, value) : value]
    }),
  )
}

function normalizeTypedDataValue(
  types: TypedDataTypes,
  type: string,
  value: unknown,
): unknown {
  if (value === null || value === undefined) return value
  const array = type.match(/^(.+)\[\d*\]$/u)
  if (array) {
    return Array.isArray(value)
      ? value.map((item) => normalizeTypedDataValue(types, array[1], item))
      : value
  }
  if (/^u?int\d*$/u.test(type)) {
    return typeof value === 'string' || typeof value === 'number'
      ? BigInt(value)
      : value
  }
  return types[type]
    ? normalizeTypedDataMessage(types, type, value as Record<string, unknown>)
    : value
}
