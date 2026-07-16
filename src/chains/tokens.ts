import type { Address } from 'viem'
import { isAddress } from 'viem'
import type { ChainCatalog } from './catalog'

export type CanonicalTokenSymbol = 'ETH' | 'WETH' | 'USDC' | 'USDT' | 'USDT0'

function getEntry(catalog: ChainCatalog, chainId: number) {
  const entry = catalog.getEntry(chainId)
  if (!entry) throw new Error(`Unsupported chain ${chainId}`)
  return entry
}

export function getTokenAddress(
  catalog: ChainCatalog,
  symbol: CanonicalTokenSymbol,
  chainId: number,
): Address {
  const token = getEntry(catalog, chainId).tokens.find(
    (candidate) => candidate.symbol === symbol,
  )
  if (!token)
    throw new Error(`Unsupported token ${symbol} for chain ${chainId}`)
  return token.address as Address
}

export function getTokenSymbol(
  catalog: ChainCatalog,
  address: Address,
  chainId: number,
): string | undefined {
  return getEntry(catalog, chainId).tokens.find(
    (candidate) => candidate.address.toLowerCase() === address.toLowerCase(),
  )?.symbol
}

export function getWrappedNativeTokenAddress(
  catalog: ChainCatalog,
  chainId: number,
): Address {
  const entry = getEntry(catalog, chainId)
  const token =
    entry.wrappedNativeToken ??
    entry.tokens.find((candidate) => candidate.symbol === 'WETH')
  if (!token) throw new Error(`Unsupported token WETH for chain ${chainId}`)
  return token.address as Address
}

export function normalizeTokenAddress(
  catalog: ChainCatalog,
  token: CanonicalTokenSymbol | Address | string,
  chainId: number,
  nonEvm: boolean,
): Address | string {
  if (isAddress(token)) return token
  if (nonEvm) return token
  return getTokenAddress(catalog, token as CanonicalTokenSymbol, chainId)
}
