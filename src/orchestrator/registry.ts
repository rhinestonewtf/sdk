import { type Address, type Chain, isAddress, zeroAddress } from 'viem'
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  sepolia,
  soneium,
  zksync,
} from 'viem/chains'
import type { TokenSymbol } from '../types'
import registryData from './registry.json'
import type { TokenConfig } from './types'

interface TokenEntry {
  symbol: string
  address: Address
  decimals: number
  balanceSlot: number | null
}

interface ChainContracts {
  spokepool: Address
  hook: Address
  originModule: Address
  targetModule: Address
  sameChainModule: Address
}

interface ChainEntry {
  name: string
  contracts: ChainContracts
  tokens: TokenEntry[]
}

interface Registry {
  [chainId: string]: ChainEntry
}

const registry: Registry = registryData as Registry

function getSupportedChainIds(): number[] {
  return Object.keys(registry).map((chainId) => parseInt(chainId, 10))
}

function getChainEntry(chainId: number): ChainEntry | undefined {
  return registry[chainId.toString()]
}

function getWethAddress(chain: Chain): Address {
  const chainEntry = getChainEntry(chain.id)
  if (!chainEntry) {
    throw new Error(`Unsupported chain ${chain.id}`)
  }

  const wethToken = chainEntry.tokens.find((token) => token.symbol === 'WETH')
  if (!wethToken) {
    throw new Error(`WETH not found for chain ${chain.id}`)
  }

  return wethToken.address
}

function getTokenSymbol(tokenAddress: Address, chainId: number): string {
  const chainEntry = getChainEntry(chainId)
  if (!chainEntry) {
    throw new Error(`Unsupported chain ${chainId}`)
  }

  const token = chainEntry.tokens.find(
    (t) => t.address.toLowerCase() === tokenAddress.toLowerCase(),
  )

  if (!token) {
    throw new Error(
      `Unsupported token address ${tokenAddress} for chain ${chainId}`,
    )
  }

  return token.symbol
}

function getTokenAddress(tokenSymbol: TokenSymbol, chainId: number): Address {
  if (chainId === 137 && tokenSymbol === 'ETH') {
    throw new Error(`Chain ${chainId} does not allow for ETH to be used`)
  }
  if (tokenSymbol === 'ETH') {
    return zeroAddress
  }

  const chainEntry = getChainEntry(chainId)
  if (!chainEntry) {
    throw new Error(`Unsupported chain ${chainId}`)
  }

  const token = chainEntry.tokens.find((t) => t.symbol === tokenSymbol)
  if (!token) {
    throw new Error(`Unsupported token symbol ${tokenSymbol}`)
  }

  return token.address
}

function getChainById(chainId: number): Chain | undefined {
  const supportedChains: Chain[] = [
    mainnet,
    sepolia,
    base,
    baseSepolia,
    arbitrum,
    arbitrumSepolia,
    optimism,
    optimismSepolia,
    polygon,
    zksync,
    soneium,
  ]
  return supportedChains.find((chain) => chain.id === chainId)
}

function isTestnet(chainId: number): boolean {
  const chain = getChainById(chainId)
  if (!chain) {
    throw new Error(`Chain not supported: ${chainId}`)
  }
  return chain.testnet ?? false
}

function isTokenAddressSupported(address: Address, chainId: number): boolean {
  const chainEntry = getChainEntry(chainId)
  if (!chainEntry) {
    return false
  }

  return chainEntry.tokens.some(
    (token) => token.address.toLowerCase() === address.toLowerCase(),
  )
}

function getSupportedTokens(chainId: number): TokenConfig[] {
  const chainEntry = getChainEntry(chainId)
  if (!chainEntry) {
    throw new Error(`Chain not supported: ${chainId}`)
  }

  return chainEntry.tokens
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
}

// Export types for external use
export type { TokenEntry, ChainContracts, ChainEntry, Registry }
