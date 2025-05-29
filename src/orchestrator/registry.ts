import {
  type Address,
  type Chain,
  encodeAbiParameters,
  type Hex,
  keccak256,
  zeroAddress,
} from 'viem'
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
} from 'viem/chains'

import { TokenConfig } from './types'

function getWethAddress(chain: Chain) {
  switch (chain.id) {
    case mainnet.id: {
      return '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    }
    case sepolia.id: {
      return '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'
    }
    case base.id: {
      return '0x4200000000000000000000000000000000000006'
    }
    case baseSepolia.id: {
      return '0x4200000000000000000000000000000000000006'
    }
    case arbitrum.id: {
      return '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
    }
    case arbitrumSepolia.id: {
      return '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73'
    }
    case optimism.id: {
      return '0x4200000000000000000000000000000000000006'
    }
    case optimismSepolia.id: {
      return '0x4200000000000000000000000000000000000006'
    }
    case polygon.id: {
      return '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'
    }
    case polygonAmoy.id: {
      return '0x52eF3d68BaB452a294342DC3e5f464d7f610f72E'
    }
    default: {
      throw new Error(`Unsupported chain ${chain.id}`)
    }
  }
}

function getUsdcAddress(chain: Chain) {
  switch (chain.id) {
    case mainnet.id: {
      return '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    }
    case sepolia.id: {
      return '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
    }
    case base.id: {
      return '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    }
    case baseSepolia.id: {
      return '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
    }
    case arbitrum.id: {
      return '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
    }
    case arbitrumSepolia.id: {
      return '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
    }
    case optimism.id: {
      return '0x0b2c639c533813f4aa9d7837caf62653d097ff85'
    }
    case optimismSepolia.id: {
      return '0x5fd84259d66Cd46123540766Be93DFE6D43130D7'
    }
    case polygon.id: {
      return '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'
    }
    case polygonAmoy.id: {
      return '0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582'
    }
    default: {
      throw new Error(`Unsupported chain ${chain.id}`)
    }
  }
}

function getTokenRootBalanceSlot(
  chain: Chain,
  tokenAddress: Address,
): bigint | null {
  switch (chain.id) {
    case mainnet.id: {
      // ETH
      if (tokenAddress === zeroAddress) {
        return null
      }
      // USDC
      if (tokenAddress === '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48') {
        return 9n
      }
      // WETH
      if (tokenAddress === '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2') {
        return 3n
      }
      break
    }
    case sepolia.id: {
      // ETH
      if (tokenAddress === zeroAddress) {
        return null
      }
      // USDC
      if (tokenAddress === '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238') {
        return 9n
      }
      // WETH
      if (tokenAddress === '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14') {
        return 3n
      }
      break
    }
    case base.id: {
      // ETH
      if (tokenAddress === zeroAddress) {
        return null
      }
      // USDC
      if (tokenAddress === '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913') {
        return 9n
      }
      // WETH
      if (tokenAddress === '0x4200000000000000000000000000000000000006') {
        return 3n
      }
      break
    }
    case baseSepolia.id: {
      // ETH
      if (tokenAddress === zeroAddress) {
        return null
      }
      // USDC
      if (tokenAddress === '0x036CbD53842c5426634e7929541eC2318f3dCF7e') {
        return 9n
      }
      // WETH
      if (tokenAddress === '0x4200000000000000000000000000000000000006') {
        return 3n
      }
      break
    }
    case arbitrum.id: {
      // ETH
      if (tokenAddress === zeroAddress) {
        return null
      }
      // USDC
      if (tokenAddress === '0xaf88d065e77c8cC2239327C5EDb3A432268e5831') {
        return 9n
      }
      // WETH
      if (tokenAddress === '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1') {
        return 51n
      }
      break
    }
    case arbitrumSepolia.id: {
      // ETH
      if (tokenAddress === zeroAddress) {
        return null
      }
      // USDC
      if (tokenAddress === '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d') {
        return 9n
      }
      // WETH
      if (tokenAddress === '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73') {
        return 51n
      }
      break
    }
    case optimism.id: {
      // ETH
      if (tokenAddress === zeroAddress) {
        return null
      }
      // USDC
      if (tokenAddress === '0x0b2c639c533813f4aa9d7837caf62653d097ff85') {
        return 9n
      }
      // WETH
      if (tokenAddress === '0x4200000000000000000000000000000000000006') {
        return 3n
      }
      break
    }
    case optimismSepolia.id: {
      // ETH
      if (tokenAddress === zeroAddress) {
        return null
      }
      // USDC
      if (tokenAddress === '0x5fd84259d66Cd46123540766Be93DFE6D43130D7') {
        return 9n
      }
      // WETH
      if (tokenAddress === '0x4200000000000000000000000000000000000006') {
        return 3n
      }
      break
    }
    case polygon.id: {
      // USDC
      if (tokenAddress === '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359') {
        return 9n
      }
      // WETH
      if (tokenAddress === '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619') {
        return 3n
      }
      break
    }
    case polygonAmoy.id: {
      // USDC
      if (tokenAddress === '0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582') {
        return 9n
      }
      // WETH
      if (tokenAddress === '0x52eF3d68BaB452a294342DC3e5f464d7f610f72E') {
        return 3n
      }
      break
    }
  }

  throw new Error(
    `Unsupported token address ${tokenAddress} for chain ${chain.id}`,
  )
}

function getTokenBalanceSlot(
  tokenSymbol: string,
  chainId: number,
  accountAddress: Address,
): Hex {
  const tokenAddress = getTokenAddress(tokenSymbol, chainId)
  const chain = getChainById(chainId)
  if (!chain) {
    throw new Error(`Unsupported chain: ${chainId}`)
  }
  const rootBalanceSlot = getTokenRootBalanceSlot(chain, tokenAddress)
  const balanceSlot = rootBalanceSlot
    ? keccak256(
        encodeAbiParameters(
          [{ type: 'address' }, { type: 'uint256' }],
          [accountAddress, rootBalanceSlot],
        ),
      )
    : '0x'
  return balanceSlot
}

function getHookAddress(_chainId?: number): Address {
  return '0x0000000000f6Ed8Be424d673c63eeFF8b9267420'
}

function getSameChainModuleAddress(_chainId?: number): Address {
  return '0x000000000043ff16d5776c7F0f65Ec485C17Ca04'
}

function getTargetModuleAddress(_chainId?: number): Address {
  return '0x0000000000E5a37279A001301A837a91b5de1D5E'
}

function getRhinestoneSpokePoolAddress(_chainId?: number): Address {
  return '0x000000000060f6e853447881951574CDd0663530'
}

function getTokenSymbol(tokenAddress: Address, chainId: number): string {
  const knownSymbols = getKnownSymbols()
  for (const symbol of knownSymbols) {
    const address = getTokenAddress(symbol, chainId)
    if (address.toLowerCase() === tokenAddress.toLowerCase()) {
      return symbol
    }
  }
  throw new Error(
    `Unsupported token address ${tokenAddress} for chain ${chainId}`,
  )
}

function getTokenAddress(tokenSymbol: string, chainId: number): Address {
  if (chainId === 137 && tokenSymbol === 'ETH') {
    throw new Error(`Chain ${chainId} does not allow for ETH to be used`)
  }
  if (tokenSymbol === 'ETH') {
    return zeroAddress
  }
  const chain = getChainById(chainId)
  if (!chain) {
    throw new Error(`Unsupported chain ${chainId}`)
  }
  if (tokenSymbol === 'WETH') {
    return getWethAddress(chain)
  }
  if (tokenSymbol === 'USDC') {
    return getUsdcAddress(chain)
  }
  throw new Error(`Unsupported token symbol ${tokenSymbol}`)
}

function getChainById(chainId: number) {
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
    polygonAmoy,
  ]
  for (const chain of supportedChains) {
    if (chain.id === chainId) {
      return chain
    }
  }
}

function isTestnet(chainId: number) {
  const chain = getChainById(chainId)
  if (!chain) {
    throw new Error(`Chain not supported: ${chainId}`)
  }
  return chain.testnet ?? false
}

function isTokenAddressSupported(address: Address, chainId: number): boolean {
  const chain = getChainById(chainId)
  if (!chain) {
    throw new Error(`Chain not supported: ${chainId}`)
  }
  try {
    getTokenSymbol(address, chainId)
    return true
  } catch {
    return false
  }
}

function getSupportedTokens(chainId: number): TokenConfig[] {
  const chain = getChainById(chainId)
  if (!chain) {
    throw new Error(`Chain not supported: ${chainId}`)
  }

  const knownSymbols = getKnownSymbols()
  return knownSymbols.map((symbol) => {
    const decimals = getTokenDecimals(symbol)
    const address = getTokenAddress(symbol, chainId)
    return {
      symbol,
      address,
      decimals,
      balanceSlot: (accountAddress: Address) =>
        getTokenBalanceSlot(symbol, chainId, accountAddress),
    }
  })
}

function getKnownSymbols(): string[] {
  return ['ETH', 'WETH', 'USDC']
}

function getTokenDecimals(symbol: string): number {
  switch (symbol) {
    case 'ETH':
    case 'WETH':
      return 18
    case 'USDC':
      return 6
    default:
      throw new Error(`Symbol not supported: ${symbol}`)
  }
}

function getDefaultAccountAccessList() {
  return {
    chainIds: [mainnet.id, base.id, arbitrum.id, optimism.id],
  }
}

export {
  getTokenSymbol,
  getTokenAddress,
  getTokenRootBalanceSlot,
  getTokenBalanceSlot,
  getWethAddress,
  getHookAddress,
  getSameChainModuleAddress,
  getTargetModuleAddress,
  getRhinestoneSpokePoolAddress,
  getChainById,
  getSupportedTokens,
  isTestnet,
  isTokenAddressSupported,
  getDefaultAccountAccessList,
}
