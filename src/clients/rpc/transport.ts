import { http, type Transport } from 'viem'
import { resolveRpcUrl } from './providers'
import type { RpcProvider } from './types'

export function createRpcTransport(
  chainId: number,
  provider: RpcProvider,
): Transport {
  return http(resolveRpcUrl(chainId, provider))
}
