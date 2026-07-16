import { providerRegistry } from '@rhinestone/shared-configs'
import type { RpcProvider } from './types'

export function getAlchemyRpcUrl(chainId: number, apiKey: string): string {
  const chainParameter = providerRegistry.Alchemy.chain_mapping[chainId]
  if (!chainParameter) throw new Error(`Unsupported chain: ${chainId}`)
  return (
    providerRegistry.Alchemy.url_template
      .replace('{{chain_param}}', chainParameter)
      // biome-ignore lint/suspicious/noTemplateCurlyInString: upstream placeholder token
      .replace('${ALCHEMY_API_KEY}', apiKey)
  )
}

export function resolveRpcUrl(
  chainId: number,
  provider: RpcProvider,
): string | undefined {
  switch (provider.kind) {
    case 'public':
      return undefined
    case 'alchemy':
      return getAlchemyRpcUrl(chainId, provider.apiKey)
    case 'custom':
      return provider.urls[chainId]
  }
}
