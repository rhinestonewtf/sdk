import type { Address } from 'viem'
import { isAddress } from 'viem'
import type { ChainCatalog } from './catalog'
import { UnsupportedChainError, UnsupportedTokenError } from './errors'

export type TokenSymbol = 'ETH' | 'WETH' | 'USDC' | 'USDT' | 'USDT0'

function getEntry(catalog: ChainCatalog, chainId: number) {
  const entry = catalog.getEntry(chainId)
  if (!entry) throw new UnsupportedChainError(chainId)
  return entry
}

export function getTokenAddress(
  catalog: ChainCatalog,
  symbol: TokenSymbol,
  chainId: number,
): Address {
  const token = getEntry(catalog, chainId).tokens.find(
    (candidate) => candidate.symbol === symbol,
  )
  if (!token) throw new UnsupportedTokenError(symbol, chainId)
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
  if (!token) throw new UnsupportedTokenError('WETH', chainId)
  return token.address as Address
}

export function normalizeTokenAddress(
  catalog: ChainCatalog,
  token: TokenSymbol | Address | string,
  chainId: number,
  nonEvm: boolean,
): Address | string {
  if (isAddress(token)) return token
  if (nonEvm) return token
  return getTokenAddress(catalog, token as TokenSymbol, chainId)
}
