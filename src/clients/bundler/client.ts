import { entryPoint07Address } from 'viem/account-abstraction'
import type { ResolvedServiceEndpoint } from '../../config/resolved'
import { type JsonRpcFetchPort, requestJsonRpc } from '../json-rpc'
import { resolveBundlerUrl } from './endpoints'
import type {
  BundlerGasEstimate,
  BundlerGasPrice,
  BundlerPort,
  BundlerUserOperation,
} from './port'

export function createBundlerClient(input: {
  readonly endpoint?: ResolvedServiceEndpoint
  readonly fetch?: JsonRpcFetchPort
}): BundlerPort {
  const fetchPort = input.fetch ?? globalThis.fetch
  const request = (
    chainId: number,
    method: string,
    params: readonly unknown[],
  ): Promise<unknown> =>
    requestJsonRpc({
      fetch: fetchPort,
      url: resolveBundlerUrl(chainId, input.endpoint),
      method,
      params,
    })
  return {
    estimateGas: async (chain, operation) =>
      mapGasEstimate(
        await request(chain.id, 'eth_estimateUserOperationGas', [
          serializeUserOperation(operation),
          entryPoint07Address,
        ]),
      ),
    getGasPrice: async (chain) =>
      mapGasPrice(
        await request(chain.id, 'pimlico_getUserOperationGasPrice', []),
      ),
    send: async (chain, operation) =>
      (await request(chain.id, 'eth_sendUserOperation', [
        serializeUserOperation(operation),
        entryPoint07Address,
      ])) as `0x${string}`,
    getReceipt: async (chain, hash) => {
      const receipt = await request(chain.id, 'eth_getUserOperationReceipt', [
        hash,
      ])
      return receipt === null
        ? undefined
        : (receipt as Awaited<ReturnType<BundlerPort['getReceipt']>>)
    },
  }
}

export function serializeUserOperation(
  operation: BundlerUserOperation,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(operation)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        typeof value === 'bigint' ? `0x${value.toString(16)}` : value,
      ]),
  )
}

function mapGasEstimate(value: unknown): BundlerGasEstimate {
  const result = value as Record<string, string | undefined>
  return {
    callGasLimit: parseQuantity(result.callGasLimit),
    verificationGasLimit: parseQuantity(result.verificationGasLimit),
    preVerificationGas: parseQuantity(result.preVerificationGas),
    ...(result.paymasterVerificationGasLimit
      ? {
          paymasterVerificationGasLimit: parseQuantity(
            result.paymasterVerificationGasLimit,
          ),
        }
      : {}),
    ...(result.paymasterPostOpGasLimit
      ? {
          paymasterPostOpGasLimit: parseQuantity(
            result.paymasterPostOpGasLimit,
          ),
        }
      : {}),
  }
}

function mapGasPrice(value: unknown): BundlerGasPrice {
  const result = value as {
    readonly fast?: {
      readonly maxFeePerGas?: string
      readonly maxPriorityFeePerGas?: string
    }
  }
  return {
    maxFeePerGas: parseQuantity(result.fast?.maxFeePerGas),
    maxPriorityFeePerGas: parseQuantity(result.fast?.maxPriorityFeePerGas),
  }
}

function parseQuantity(value: string | undefined): bigint {
  if (value === undefined) throw new Error('JSON-RPC quantity is missing')
  return BigInt(value)
}
