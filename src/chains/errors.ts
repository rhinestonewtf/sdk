/**
 * Thrown by the SDK's local chain/token registry — not an orchestrator API
 * error. Kept distinct from `OrchestratorClientError` so consumers can catch
 * unsupported-chain/token failures separately from server-side errors.
 */
export class UnsupportedChainError extends Error {
  readonly chainId: number

  constructor(chainId: number) {
    super(`Unsupported chain ${chainId}`)
    this.chainId = chainId
  }
}

export class UnsupportedTokenError extends Error {
  readonly tokenSymbol: string
  readonly chainId: number

  constructor(tokenSymbol: string, chainId: number) {
    super(`Unsupported token ${tokenSymbol} for chain ${chainId}`)
    this.tokenSymbol = tokenSymbol
    this.chainId = chainId
  }
}
