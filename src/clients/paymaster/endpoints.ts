import type { ResolvedServiceEndpoint } from '../../config/resolved'

export function resolvePaymasterUrl(
  chainId: number,
  endpoint: ResolvedServiceEndpoint,
): string {
  switch (endpoint.kind) {
    case 'pimlico':
      return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${endpoint.apiKey}`
    case 'biconomy':
      return `https://paymaster.biconomy.io/api/v2/${chainId}/${endpoint.apiKey}`
    case 'custom': {
      const url =
        typeof endpoint.urls === 'string'
          ? endpoint.urls
          : endpoint.urls[chainId]
      if (!url)
        throw new Error(`No paymaster URL configured for chain ${chainId}`)
      return url
    }
  }
}
