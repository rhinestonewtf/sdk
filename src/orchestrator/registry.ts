import {
  type ChainEntry,
  chainRegistry,
  chains,
} from '@rhinestone/shared-configs'
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
  sonic,
} from 'viem/chains'
import type { TokenSymbol } from '../types'
import type { SupportedChain, TokenConfig } from './types'

function getSupportedChainIds(): number[] {
  return chains.map((chain) => chain.id)
}

function getChainEntry(chainId: number): ChainEntry | undefined {
  return chainRegistry[chainId.toString()]
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
  if (chainId === polygon.id && tokenSymbol === 'ETH') {
    throw new Error(`Chain ${chainId} does not allow for ETH to be used`)
  }
  if (chainId === sonic.id && tokenSymbol !== 'USDC') {
    throw new Error(`Chain ${chainId} only has USDC available`)
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

function isChainIdSupported(chainId: number): chainId is SupportedChain {
  const chainIds = chains.map(chain => chain.id) as number[]
  return chainIds.includes(chainId)
}

function getChainById(chainId: number): Chain {
  const chains: Record<SupportedChain, Chain> = {
    [mainnet.id]: mainnet,
    [sepolia.id]: sepolia,
    [base.id]: base,
    [baseSepolia.id]: baseSepolia,
    [arbitrum.id]: arbitrum,
    [arbitrumSepolia.id]: arbitrumSepolia,
    [optimism.id]: optimism,
    [optimismSepolia.id]: optimismSepolia,
    [polygon.id]: polygon,
    [soneium.id]: soneium,
    [sonic.id]: sonic,
  }

  if (!isChainIdSupported(chainId)) {
    throw new Error(`Chain not supported: ${chainId}`)
  }
  return chains[chainId]
}

function isTestnet(chainId: number): boolean {
  const chain = getChainById(chainId)
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
