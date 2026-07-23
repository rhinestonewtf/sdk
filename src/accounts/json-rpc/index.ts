import { type Chain, http, type Transport } from 'viem'
import type { ProviderConfig } from '../../types'
import { getCustomUrl } from './providers'

function createTransport(chain: Chain, provider?: ProviderConfig): Transport {
  if (!provider) {
    return http()
  }
  // Caller supplies the RPC URL per chain (v2: the SDK no longer bundles
  // provider slugs or builds Alchemy URLs). Falls back to viem's default
  // transport when no URL is configured for this chain.
  const customUrl = getCustomUrl(chain.id, provider.urls)
  return http(customUrl)
}

export { createTransport }
