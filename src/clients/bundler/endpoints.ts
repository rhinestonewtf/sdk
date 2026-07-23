import type { ResolvedServiceEndpoint } from '../../config/resolved'

export function resolveBundlerUrl(
  chainId: number,
  endpoint?: ResolvedServiceEndpoint,
): string {
  if (!endpoint) return `https://public.pimlico.io/v2/${chainId}/rpc`
  switch (endpoint.kind) {
    case 'pimlico':
      return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${endpoint.apiKey}`
    case 'biconomy':
      return `https://bundler.biconomy.io/api/v3/${chainId}/${endpoint.apiKey}`
    case 'custom': {
      const url =
        typeof endpoint.urls === 'string'
          ? endpoint.urls
          : endpoint.urls[chainId]
      if (!url)
        throw new Error(`No bundler URL configured for chain ${chainId}`)
      return url
    }
  }
}
