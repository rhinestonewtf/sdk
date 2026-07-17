import type { OrchestratorQuote } from '../../clients/orchestrator/types'

export function selectIntentQuote(
  quotes: readonly OrchestratorQuote[],
  intentId?: string,
): OrchestratorQuote {
  const quote = intentId
    ? quotes.find((candidate) => candidate.intentId === intentId)
    : quotes[0]
  if (!quote) {
    throw new Error(
      intentId
        ? `Quote ${intentId} is not in the prepared transaction`
        : 'Orchestrator returned no quote',
    )
  }
  return quote
}
