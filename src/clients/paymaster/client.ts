import { custom } from 'viem'
import {
  createPaymasterClient as createViemPaymasterClient,
  entryPoint07Address,
} from 'viem/account-abstraction'
import type { ResolvedServiceEndpoint } from '../../config/resolved'
import { type JsonRpcFetchPort, requestJsonRpc } from '../json-rpc'
import { resolvePaymasterUrl } from './endpoints'
import type { PaymasterPort, PaymasterSponsorship } from './port'

export function createPaymasterClient(input: {
  readonly endpoint: ResolvedServiceEndpoint
  readonly fetch?: JsonRpcFetchPort
}): PaymasterPort {
  const fetchPort = input.fetch ?? globalThis.fetch
  const client = (chainId: number) =>
    createViemPaymasterClient({
      transport: custom({
        request: ({ method, params }) =>
          requestJsonRpc({
            fetch: fetchPort,
            url: resolvePaymasterUrl(chainId, input.endpoint),
            method,
            params: params ?? [],
          }),
      }),
    })
  return {
    getStubData: async (chain, operation) => {
      const {
        isFinal = false,
        sponsor: _,
        ...stub
      } = await client(chain.id).getPaymasterStubData({
        ...operation,
        chainId: chain.id,
        entryPointAddress: entryPoint07Address,
      })
      return { ...requireV07(stub), isFinal }
    },
    getData: async (chain, operation) =>
      requireV07(
        await client(chain.id).getPaymasterData({
          ...operation,
          chainId: chain.id,
          entryPointAddress: entryPoint07Address,
        }),
      ),
  }
}

function requireV07(value: {
  readonly paymaster?: `0x${string}`
  readonly paymasterData?: `0x${string}`
}): PaymasterSponsorship {
  if (!value.paymaster || !value.paymasterData) {
    throw new Error('Paymaster response is missing paymaster fields')
  }
  return value as PaymasterSponsorship
}
