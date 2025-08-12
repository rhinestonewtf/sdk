import type { SupportedChain } from '../../orchestrator'

import registry from './providers.json'

type ProviderName = 'DRPC' | 'Alchemy' | 'local-rpc'

type ProviderRegistry = Record<
  ProviderName,
  {
    url_template: string
    chain_mapping: Partial<Record<SupportedChain, string>>
  }
>

const providerRegistry: ProviderRegistry = registry

function getAlchemyUrl(chainId: SupportedChain, apiKey: string): string {
  const urlTemplate = providerRegistry.Alchemy.url_template
  const chainParam = providerRegistry.Alchemy.chain_mapping[chainId]
  if (!chainParam) {
    throw new Error(`Unsupported chain: ${chainId}`)
  }
  return urlTemplate
    .replace('{{chain_param}}', chainParam)
    .replace('\$\{ALCHEMY_API_KEY\}', apiKey)
}

export { getAlchemyUrl }
