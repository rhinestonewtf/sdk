import { describe, expect, test, vi } from 'vitest'
import { toEvmChainReference } from '../../chains/caip2'
import { createBundlerClient, serializeUserOperation } from './client'
import type { BundlerUserOperation } from './port'

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

describe('bundler client', () => {
  test('serializes UserOperation quantities', () => {
    expect(serializeUserOperation(operation)).toEqual({
      sender: operation.sender,
      nonce: '0x1',
      callData: '0x1234',
      callGasLimit: '0x2',
      verificationGasLimit: '0x3',
      preVerificationGas: '0x4',
      maxFeePerGas: '0x5',
      maxPriorityFeePerGas: '0x6',
      signature: '0x',
    })
  })

  test('uses the selected endpoint and maps gas estimates', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body))
        expect(request.method).toBe('eth_estimateUserOperationGas')
        return Response.json({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            callGasLimit: '0x10',
            verificationGasLimit: '0x20',
            preVerificationGas: '0x30',
          },
        })
      },
    )
    const client = createBundlerClient({
      endpoint: { kind: 'custom', urls: { 10: 'https://bundler.example' } },
      fetch,
    })

    await expect(
      client.estimateGas(toEvmChainReference(10), operation),
    ).resolves.toEqual({
      callGasLimit: 16n,
      verificationGasLimit: 32n,
      preVerificationGas: 48n,
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://bundler.example',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
