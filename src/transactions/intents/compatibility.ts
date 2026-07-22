import type {
  OrchestratorIntentRequest,
  OrchestratorQuote,
} from '../../clients/orchestrator/types'

export function projectCompatibleIntentInput(
  input: OrchestratorIntentRequest,
): unknown {
  return serializeBigInts(input)
}

export function projectCompatibleQuote(
  quote: OrchestratorQuote,
): OrchestratorQuote {
  return {
    ...quote,
    signData: serializeBigInts(quote.signData) as OrchestratorQuote['signData'],
  }
}

function serializeBigInts(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(serializeBigInts)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeBigInts(item)]),
    )
  }
  return value
}
