import type { RpcProvider } from './types'

export function resolveRpcUrl(
  chainId: number,
  provider: RpcProvider,
): string | undefined {
  switch (provider.kind) {
    case 'public':
      return undefined
    case 'custom':
      return provider.urls[chainId]
  }
}
