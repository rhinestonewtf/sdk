import { providerRegistry as providers } from '@rhinestone/shared-configs'

import type { SupportedChain } from '../../orchestrator'

function getAlchemyUrl(chainId: SupportedChain, apiKey: string): string {
  const urlTemplate = providers.Alchemy.url_template
  const chainParam = providers.Alchemy.chain_mapping[chainId]
  if (!chainParam) {
    throw new Error(`Unsupported chain: ${chainId}`)
  }
  return urlTemplate
    .replace('{{chain_param}}', chainParam)
    .replace('\$\{ALCHEMY_API_KEY\}', apiKey)
}

function getCustomUrl(chainId: number, urls: Record<number, string>): string {
  const url = urls[chainId]
  if (!url) {
    throw new Error(`No custom provider URL configured for chain ${chainId}`)
  }
  return url
}

export { getAlchemyUrl, getCustomUrl }
