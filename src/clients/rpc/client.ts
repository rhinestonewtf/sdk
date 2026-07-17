import type { Chain } from 'viem'
import { createPublicClient } from 'viem'
import { getSupportedChain, sharedChainCatalog } from '../../chains/catalog'
import type { EvmChainReference } from '../../chains/types'
import type { RpcPort, RpcReadPort } from './port'
import { createRpcTransport } from './transport'
import type { ContractRead, RpcProvider } from './types'

export function createRpcReadPort(
  chain: Chain,
  provider: RpcProvider,
): RpcReadPort {
  const client = createPublicClient({
    chain,
    transport: createRpcTransport(chain.id, provider),
  })
  const read = async <TResult>(
    request: ContractRead<TResult>,
    blockNumber?: bigint,
  ): Promise<TResult> =>
    client.readContract({
      address: request.address,
      abi: request.abi,
      functionName: request.functionName,
      ...(request.args ? { args: request.args } : {}),
      ...(blockNumber === undefined ? {} : { blockNumber }),
    } as never) as Promise<TResult>

  return {
    getCode: async (context, address) => ({
      code: await client.getCode({
        address,
        ...(context.blockNumber === undefined
          ? {}
          : { blockNumber: context.blockNumber }),
      }),
    }),
    getTransactionCount: async (context, address) =>
      BigInt(
        await client.getTransactionCount({
          address,
          ...(context.blockNumber === undefined
            ? {}
            : { blockNumber: context.blockNumber }),
        }),
      ),
    readContract: (context, request) => read(request, context.blockNumber),
    multicall: async <TResults extends readonly unknown[]>(
      context: Parameters<RpcReadPort['multicall']>[0],
      requests: Parameters<RpcReadPort['multicall']>[1],
    ): Promise<TResults> =>
      Promise.all(
        requests.map(async (request) => {
          try {
            return { result: await read(request, context.blockNumber) }
          } catch (error) {
            return { error }
          }
        }),
      ) as unknown as Promise<TResults>,
  }
}

export function createRpcPort(provider: RpcProvider): RpcPort {
  const readers = new Map<number, RpcReadPort>()
  return {
    forChain: (chain: EvmChainReference) => {
      const existing = readers.get(chain.id)
      if (existing) return existing
      const reader = createRpcReadPort(
        getSupportedChain(sharedChainCatalog, chain.id),
        provider,
      )
      readers.set(chain.id, reader)
      return reader
    },
  }
}
