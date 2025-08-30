import { SupportedChain } from '../../orchestrator/types'

const url_template = "https://{{chain_param}}.g.alchemy.com/v2/${ALCHEMY_API_KEY}";
const chain_mapping: Record<SupportedChain, string> = {
    1: "eth-mainnet",
    10: "opt-mainnet",
    137: "polygon-mainnet",
    11155111: "eth-sepolia",
    11155420: "opt-sepolia",
    84532: "base-sepolia",
    421614: "arb-sepolia",
    324: "zksync-mainnet",
    8453: "base-mainnet",
    42161: "arb-mainnet",
    146: "sonic-mainnet",
    80002: "polygon-amoy",
}

function getAlchemyUrl(chainId: SupportedChain, apiKey: string): string {
  const urlTemplate = url_template
  const chainParam = chain_mapping[chainId]
  if (!chainParam) {
    throw new Error(`Unsupported chain: ${chainId}`)
  }
  return urlTemplate
    .replace('{{chain_param}}', chainParam)
    .replace('\$\{ALCHEMY_API_KEY\}', apiKey)
}

export { getAlchemyUrl }
