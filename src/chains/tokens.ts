import { type Address, isAddress } from 'viem'

// Token inputs are per-chain ERC-20 addresses (v2 no longer bundles a token
// registry — chain/token data is fetched from the orchestrator at runtime).
// Non-EVM chains pass their token identifiers through unchanged; EVM inputs
// must be hex addresses.
export function normalizeTokenAddress(
  token: Address | string,
  chainId: number,
  nonEvm: boolean,
): Address | string {
  if (isAddress(token)) return token
  if (nonEvm) return token
  throw new Error(
    `Expected a token address on EVM chain ${chainId}, got: ${token}`,
  )
}
