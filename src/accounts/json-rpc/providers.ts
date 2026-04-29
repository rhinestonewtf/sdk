import { providerRegistry as providers } from '@rhinestone/shared-configs'

import type { SupportedChain } from '../../orchestrator'

function getAlchemyUrl(chainId: SupportedChain, apiKey: string): string {
  const urlTemplate = providers.Alchemy.url_template
  const chainParam = providers.Alchemy.chain_mapping[chainId]
  if (!chainParam) {
    throw new Error(`Unsupported chain: ${chainId}`)
  }
  return (
    urlTemplate
      .replace('{{chain_param}}', chainParam)
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder token in the upstream shared-configs url_template
      .replace('${ALCHEMY_API_KEY}', apiKey)
  )
}

function getCustomUrl(
  chainId: number,
  urls: Record<number, string>,
): string | undefined {
  return urls[chainId]
}

export { getAlchemyUrl, getCustomUrl }
