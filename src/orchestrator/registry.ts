import {
  type ChainEntry,
  chainRegistry,
  chains,
} from '@rhinestone/shared-configs'
import { type Address, type Chain, isAddress } from 'viem'
import type { TokenSymbol } from '../types'
import { UnsupportedChainError, UnsupportedTokenError } from './error'
import type { TokenConfig } from './types'

function getSupportedChainIds(): number[] {
  return chains.map((chain) => chain.id)
}

function getChainEntry(chainId: number): ChainEntry | undefined {
  return chainRegistry[chainId.toString()]
}

function getWethAddress(chain: Chain): Address {
  const chainEntry = getChainEntry(chain.id)
  if (!chainEntry) {
    throw new UnsupportedChainError(chain.id)
  }

  const wethToken = chainEntry.tokens.find((token) => token.symbol === 'WETH')
  if (!wethToken) {
    throw new UnsupportedTokenError('WETH', chain.id)
  }

  return wethToken.address
}

function getTokenSymbol(tokenAddress: Address, chainId: number): string {
  const chainEntry = getChainEntry(chainId)
  if (!chainEntry) {
    throw new UnsupportedChainError(chainId)
  }

  const token = chainEntry.tokens.find(
    (t) => t.address.toLowerCase() === tokenAddress.toLowerCase(),
  )

  if (!token) {
    throw new UnsupportedTokenError(tokenAddress, chainId)
  }

  return token.symbol
}

function getTokenAddress(tokenSymbol: TokenSymbol, chainId: number): Address {
  const chainEntry = getChainEntry(chainId)
  if (!chainEntry) {
    throw new UnsupportedChainError(chainId)
  }

  const token = chainEntry.tokens.find((t) => t.symbol === tokenSymbol)
  if (!token) {
    throw new UnsupportedTokenError(tokenSymbol, chainId)
  }

  return token.address
}

function getChainById(chainId: number): Chain {
  const chain = chains.find((chain) => chain.id === chainId)
  if (!chain) {
    throw new UnsupportedChainError(chainId)
  }
  return chain
}

function isTestnet(chainId: number): boolean {
  const chain = getChainById(chainId)
  return chain.testnet ?? false
}

function isTokenAddressSupported(address: Address, chainId: number): boolean {
  const supportedTokens = getSupportedTokens(chainId)
  return supportedTokens.some(
    (token) => token.address.toLowerCase() === address.toLowerCase(),
  )
}

function getSupportedTokens(chainId: number): TokenConfig[] {
  const chainEntry = getChainEntry(chainId)
  if (!chainEntry) {
    throw new UnsupportedChainError(chainId)
  }

  return chainEntry.tokens.filter((token) => token.supportsMultichain)
}

function getDefaultAccountAccessList(onTestnets?: boolean) {
  const supportedChainIds = getSupportedChainIds()
  const filteredChainIds = supportedChainIds.filter((chainId) => {
    try {
      return isTestnet(chainId) === !!onTestnets
    } catch {
      return false
    }
  })

  return {
    chainIds: filteredChainIds,
  }
}

function resolveTokenAddress(
  token: TokenSymbol | Address,
  chainId: number,
): Address {
  if (isAddress(token)) {
    return token
  }
  return getTokenAddress(token, chainId)
}

function getAllSupportedChainsAndTokens(): {
  chainId: number
  tokens: TokenConfig[]
}[] {
  const supportedChainIds = getSupportedChainIds()
  return supportedChainIds.map((chainId) => ({
    chainId,
    tokens: getSupportedTokens(chainId),
  }))
}

export {
  getTokenSymbol,
  getTokenAddress,
  getWethAddress,
  getChainById,
  getSupportedTokens,
  getSupportedChainIds,
  isTestnet,
  isTokenAddressSupported,
  getDefaultAccountAccessList,
  resolveTokenAddress,
  getAllSupportedChainsAndTokens,
}
