export function selectIntentQuote<Q extends { readonly intentId: string }>(
  quotes: readonly Q[],
  intentId?: string,
): Q {
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
