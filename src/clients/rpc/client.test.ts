import {
  defineChain,
  encodeAbiParameters,
  encodeFunctionResult,
  multicall3Abi,
  parseAbiParameters,
} from 'viem'
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
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
      blockCreated: 0,
    },
  },
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

  test('executes one block-consistent Multicall3 request with per-call failures', async () => {
    const ownerAbi = [
      {
        type: 'function',
        name: 'owner',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'address' }],
      },
    ] as const
    const aggregateResult = encodeFunctionResult({
      abi: multicall3Abi,
      functionName: 'aggregate3',
      result: [
        {
          success: true,
          returnData: encodeFunctionResult({
            abi: ownerAbi,
            functionName: 'owner',
            result: owner,
          }),
        },
        { success: false, returnData: '0x' },
      ],
    })
    const fake = await createFakeRpc({
      chainId: chain.id,
      responses: { eth_call: aggregateResult },
    })
    try {
      const rpc = createRpcReadPort(chain, {
        kind: 'custom',
        urls: { [chain.id]: fake.url },
      })
      const results = await rpc.multicall<
        readonly [
          { readonly result?: typeof owner; readonly error?: unknown },
          { readonly result?: typeof owner; readonly error?: unknown },
        ]
      >({ ...context, blockNumber: 7n }, [
        { address: account, abi: ownerAbi, functionName: 'owner' },
        { address: owner, abi: ownerAbi, functionName: 'owner' },
      ])

      expect(results[0]).toEqual({ result: owner })
      expect(results[1]?.error).toBeInstanceOf(Error)
      expect(fake.requests).toHaveLength(1)
      expect(fake.requests[0]).toMatchObject({
        method: 'eth_call',
        params: [
          {
            to: '0xca11bde05977b3631167028862be2a173976ca11',
          },
          '0x7',
        ],
      })
    } finally {
      await fake.close()
    }
  })
})
