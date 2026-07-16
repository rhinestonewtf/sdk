import { defineChain, encodeAbiParameters, parseAbiParameters } from 'viem'
import { describe, expect, test } from 'vitest'
import { createFakeRpc } from '../../../test/fakes/rpc'
import { createRpcReadPort } from './client'

const account = '0x0000000000000000000000000000000000000001' as const
const owner = '0x0000000000000000000000000000000000000002' as const
const chain = defineChain({
  id: 31337,
  name: 'Fake',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://localhost'] } },
})
const context = {
  chain: { kind: 'evm', id: 31337, caip2: 'eip155:31337' },
} as const

describe('RPC reader', () => {
  test('materializes code and contract reads through an explicit provider', async () => {
    const fake = await createFakeRpc({
      chainId: chain.id,
      code: '0x1234',
      responses: {
        eth_call: encodeAbiParameters(parseAbiParameters('address'), [owner]),
      },
    })
    try {
      const rpc = createRpcReadPort(chain, {
        kind: 'custom',
        urls: { [chain.id]: fake.url },
      })
      await expect(rpc.getCode(context, account)).resolves.toEqual({
        code: '0x1234',
      })
      await expect(
        rpc.readContract(context, {
          address: account,
          abi: [
            {
              type: 'function',
              name: 'owner',
              stateMutability: 'view',
              inputs: [],
              outputs: [{ type: 'address' }],
            },
          ],
          functionName: 'owner',
        }),
      ).resolves.toBe(owner)
      expect(fake.requests.map((request) => request.method)).toEqual([
        'eth_getCode',
        'eth_call',
      ])
    } finally {
      await fake.close()
    }
  })
})
