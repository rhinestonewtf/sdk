import { SupportedChain } from '../../orchestrator/types'

function getAlchemyUrl(chainId: SupportedChain, apiKey: string): string {
  const chainMapping: Record<SupportedChain, string> = {
    1: 'eth-mainnet',
    10: 'opt-mainnet',
    137: 'polygon-mainnet',
    11155111: 'eth-sepolia',
    11155420: 'opt-sepolia',
    84532: 'base-sepolia',
    421614: 'arb-sepolia',
    324: 'zksync-mainnet',
    8453: 'base-mainnet',
    42161: 'arb-mainnet',
    146: 'sonic-mainnet',
    80002: 'polygon-amoy',
  }

  const chainParam = chainMapping[chainId]
  if (!chainParam) {
    throw new Error(`Unsupported chain: ${chainId}`)
  }
  const urlTemplate = `https://${chainParam}.g.alchemy.com/v2/${apiKey}`
  return urlTemplate
}

export { getAlchemyUrl }
