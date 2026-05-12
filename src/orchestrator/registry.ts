import {
  type ChainEntry,
  chainRegistry,
  chains,
} from '@rhinestone/shared-configs'
import { type Address, type Chain, isAddress } from 'viem'
import type { TokenSymbol } from '../types'
import { isNonEvmChainId } from './caip2'
import type { NonEvmAddress } from './destinations'
import { UnsupportedChainError, UnsupportedTokenError } from './error'

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

  return wethToken.address as Address
}

function getWrappedTokenAddress(chain: Chain): Address {
  const chainEntry = getChainEntry(chain.id)
  if (!chainEntry) {
    throw new UnsupportedChainError(chain.id)
  }

  const token =
    chainEntry.wrappedNativeToken ??
    chainEntry.tokens.find((t) => t.symbol === 'WETH')
  if (!token) {
    throw new UnsupportedTokenError('WETH', chain.id)
  }
  return token.address as Address
}

function getTokenSymbol(
  tokenAddress: Address,
  chainId: number,
): string | undefined {
  const chainEntry = getChainEntry(chainId)
  if (!chainEntry) {
    throw new UnsupportedChainError(chainId)
  }

  const token = chainEntry.tokens.find(
    (t) => t.address.toLowerCase() === tokenAddress.toLowerCase(),
  )

  return token?.symbol
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

  return token.address as Address
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
  const chainEntry = getChainEntry(chainId)
  if (!chainEntry) {
    return false
  }

  return chainEntry.tokens.some(
    (token) => token.address.toLowerCase() === address.toLowerCase(),
  )
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
  token: TokenSymbol | Address | NonEvmAddress,
  chainId: number,
): Address | NonEvmAddress {
  if (isAddress(token)) {
    return token
  }
  // Non-EVM destinations carry SPL mints (base58) / Tron T-prefixed
  // addresses that don't satisfy viem's `isAddress`. The orchestrator's
  // wire schema accepts the raw string for non-EVM chains, so pass it
  // through unchanged.
  if (isNonEvmChainId(chainId)) {
    return token
  }
  // For EVM chains that aren't a hex address, the value must be a known
  // token symbol. `getTokenAddress` throws if it isn't.
  return getTokenAddress(token as TokenSymbol, chainId)
}

export {
  getTokenSymbol,
  getTokenAddress,
  getWethAddress,
  getWrappedTokenAddress,
  getChainById,
  getSupportedChainIds,
  isTestnet,
  isTokenAddressSupported,
  getDefaultAccountAccessList,
  resolveTokenAddress,
}
