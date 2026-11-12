import type { CanonicalCostToken } from './types'

function sumAmounts(values: unknown[]): string {
  let total = 0n
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue
    total += BigInt(String(value))
  }
  return total.toString()
}

function sortCostTokens(tokens: CanonicalCostToken[]): CanonicalCostToken[] {
  return [...tokens].sort((a, b) => {
    const left = `${a.chainId}:${a.token}`
    const right = `${b.chainId}:${b.token}`
    return left < right ? -1 : left > right ? 1 : 0
  })
}

export { sortCostTokens, sumAmounts }
