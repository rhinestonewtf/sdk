import { type Chain, http, type Transport } from 'viem'
import type { SupportedChain } from '../../orchestrator'
import type { ProviderConfig } from '../../types'
import { getAlchemyUrl } from './providers'

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
  }
}

export { createTransport }
