import { type Chain, http, type Transport } from 'viem'
import type { SupportedChain } from '../../orchestrator'
import type { ProviderConfig } from '../../types'
import { getAlchemyUrl, getCustomUrl } from './providers'

function createTransport(chain: Chain, provider?: ProviderConfig): Transport {
  if (!provider) {
    return http()
  }

  switch (provider.type) {
    case 'alchemy': {
      const alchemyUrl = getAlchemyUrl(
        chain.id as SupportedChain,
        provider.apiKey,
      )
      return http(alchemyUrl)
    }
    case 'custom': {
      const customUrl = getCustomUrl(chain.id, provider.urls)
      // Fall back to default provider if no custom URL configured for this chain
      return http(customUrl)
    }
  }
}

export { createTransport }
