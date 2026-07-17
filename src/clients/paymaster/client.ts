import { entryPoint07Address } from 'viem/account-abstraction'
import type { ResolvedServiceEndpoint } from '../../config/resolved'
import { serializeUserOperation } from '../bundler/client'
import { type JsonRpcFetchPort, requestJsonRpc } from '../json-rpc'
import { resolvePaymasterUrl } from './endpoints'
import type { PaymasterPort, PaymasterSponsorship } from './port'

export function createPaymasterClient(input: {
  readonly endpoint: ResolvedServiceEndpoint
  readonly fetch?: JsonRpcFetchPort
}): PaymasterPort {
  const fetchPort = input.fetch ?? globalThis.fetch
  return {
    sponsor: async (chain, operation) =>
      mapSponsorship(
        await requestJsonRpc({
          fetch: fetchPort,
          url: resolvePaymasterUrl(chain.id, input.endpoint),
          method: 'pm_sponsorUserOperation',
          params: [serializeUserOperation(operation), entryPoint07Address],
        }),
      ),
  }
}

function mapSponsorship(value: unknown): PaymasterSponsorship {
  const result = value as Record<string, string | undefined>
  if (!result.paymaster || !result.paymasterData) {
    throw new Error('Paymaster response is missing paymaster fields')
  }
  return {
    paymaster: result.paymaster as `0x${string}`,
    paymasterData: result.paymasterData as `0x${string}`,
    paymasterVerificationGasLimit: parseQuantity(
      result.paymasterVerificationGasLimit,
    ),
    paymasterPostOpGasLimit: parseQuantity(result.paymasterPostOpGasLimit),
  }
}

function parseQuantity(value: string | undefined): bigint {
  if (value === undefined) throw new Error('Paymaster gas quantity is missing')
  return BigInt(value)
}
