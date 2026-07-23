import type { Address } from 'viem'
import { arbitrumSepolia, baseSepolia } from 'viem/chains'

// Token addresses for the chains the integration suite runs against. Replaces
// the SDK's removed `getTokenAddress` (v2 no longer bundles a token registry —
// chain/token data is fetched from the orchestrator at runtime).
const TOKENS: Record<string, Record<number, Address>> = {
  USDC: {
    [baseSepolia.id]: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    [arbitrumSepolia.id]: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  },
}

export function getTokenAddress(symbol: 'USDC', chainId: number): Address {
  const address = TOKENS[symbol]?.[chainId]
  if (!address) {
    throw new Error(`No ${symbol} address configured for chain ${chainId}`)
  }
  return address
}
