import type { SerializedIntentInput } from '../../clients/orchestrator/public'
import type {
  OrchestratorIntentRequest,
  OrchestratorQuote,
} from '../../clients/orchestrator/types'

// The request is structurally the public `IntentInput` with `readonly`
// modifiers, so the serialized value is a `SerializedIntentInput` — the cast
// only re-attaches the type `serializeBigInts` erases.
export function projectCompatibleIntentInput(
  input: OrchestratorIntentRequest,
): SerializedIntentInput {
  return serializeBigInts(input) as SerializedIntentInput
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
