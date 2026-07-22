import { entryPoint07Address } from 'viem/account-abstraction'
import { describe, expect, test, vi } from 'vitest'
import { toEvmChainReference } from '../../chains/caip2'
import type { BundlerUserOperation } from '../bundler/port'
import { createPaymasterClient } from './client'

const operation: BundlerUserOperation = {
  sender: '0x0000000000000000000000000000000000000001',
  nonce: 1n,
  callData: '0x1234',
  callGasLimit: 2n,
  verificationGasLimit: 3n,
  preVerificationGas: 4n,
  maxFeePerGas: 5n,
  maxPriorityFeePerGas: 6n,
  signature: '0x',
}

describe('paymaster client', () => {
  test('uses ERC-7677 stub and final sponsorship methods', async () => {
    const requests: Array<{ method: string; params: unknown[] }> = []
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body))
        requests.push(request)
        return Response.json({
          jsonrpc: '2.0',
          id: request.id,
          result:
            request.method === 'pm_getPaymasterStubData'
              ? {
                  paymaster: operation.sender,
                  paymasterData: '0x12',
                  paymasterVerificationGasLimit: '0x20',
                  paymasterPostOpGasLimit: '0x30',
                  isFinal: false,
                }
              : {
                  paymaster: operation.sender,
                  paymasterData: '0x34',
                },
        })
      },
    )
    const client = createPaymasterClient({
      endpoint: { kind: 'custom', urls: 'https://paymaster.example' },
      fetch,
    })
    const chain = toEvmChainReference(1)

    await expect(client.getStubData(chain, operation)).resolves.toEqual({
      paymaster: operation.sender,
      paymasterData: '0x12',
      paymasterVerificationGasLimit: 32n,
      paymasterPostOpGasLimit: 48n,
      isFinal: false,
    })
    await expect(client.getData(chain, operation)).resolves.toEqual({
      paymaster: operation.sender,
      paymasterData: '0x34',
    })
    expect(requests.map(({ method }) => method)).toEqual([
      'pm_getPaymasterStubData',
      'pm_getPaymasterData',
    ])
    expect(requests[0]?.params.slice(1)).toEqual([
      entryPoint07Address,
      '0x1',
      null,
    ])
  })
})
