import type { Address, Client, Hex } from 'viem'
import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  http,
  toBytes,
  toHex,
} from 'viem'
import { createBundlerClient } from 'viem/account-abstraction'
import { readContract } from 'viem/actions'
import { getAction } from 'viem/utils'

import type { BundlerConfig, RhinestoneAccountConfig } from '../types'

type CallType = 'call' | 'delegatecall' | 'batchcall'

interface ValidatorConfig {
  address: Address
  isRoot: boolean
}

interface ExecutionMode<callType extends CallType> {
  type: callType
  revertOnError?: boolean
  selector?: Hex
  context?: Hex
}

interface EncodeCallDataParams<callType extends CallType> {
  mode: ExecutionMode<callType>
  callData: readonly {
    to: Address
    value?: bigint | undefined
    data?: Hex | undefined
  }[]
}

interface GetAccountNonceParams {
  address: Address
  entryPointAddress: Address
  key?: bigint
}

interface UserOperationGasPriceResponse {
  jsonrpc: '2.0'
  id: 1
  result: {
    slow: {
      maxFeePerGas: Hex
      maxPriorityFeePerGas: Hex
    }
    standard: {
      maxFeePerGas: Hex
      maxPriorityFeePerGas: Hex
    }
    fast: {
      maxFeePerGas: Hex
      maxPriorityFeePerGas: Hex
    }
  }
}

function parseCallType(callType: CallType) {
  switch (callType) {
    case 'call':
      return '0x00'
    case 'batchcall':
      return '0x01'
    case 'delegatecall':
      return '0xff'
  }
}

function encodeExecutionMode<callType extends CallType>({
  type,
  revertOnError,
  selector,
  context,
}: ExecutionMode<callType>): Hex {
  return encodePacked(
    ['bytes1', 'bytes1', 'bytes4', 'bytes4', 'bytes22'],
    [
      toHex(toBytes(parseCallType(type), { size: 1 })),
      toHex(toBytes(revertOnError ? '0x01' : '0x00', { size: 1 })),
      toHex(toBytes('0x0', { size: 4 })),
      toHex(toBytes(selector ?? '0x', { size: 4 })),
      toHex(toBytes(context ?? '0x', { size: 22 })),
    ],
  )
}

function encode7579Calls<callType extends CallType>({
  mode,
  callData,
}: EncodeCallDataParams<callType>): Hex {
  if (callData.length > 1 && mode?.type !== 'batchcall') {
    throw new Error(
      `mode ${JSON.stringify(mode)} does not supported for batchcall calldata`,
    )
  }

  const executeAbi = [
    {
      type: 'function',
      name: 'execute',
      inputs: [
        {
          name: 'execMode',
          type: 'bytes32',
          internalType: 'ExecMode',
        },
        {
          name: 'executionCalldata',
          type: 'bytes',
          internalType: 'bytes',
        },
      ],
      outputs: [],
      stateMutability: 'payable',
    },
  ] as const

  if (callData.length > 1) {
    return encodeFunctionData({
      abi: executeAbi,
      functionName: 'execute',
      args: [
        encodeExecutionMode(mode),
        encodeAbiParameters(
          [
            {
              name: 'executionBatch',
              type: 'tuple[]',
              components: [
                {
                  name: 'target',
                  type: 'address',
                },
                {
                  name: 'value',
                  type: 'uint256',
                },
                {
                  name: 'callData',
                  type: 'bytes',
                },
              ],
            },
          ],
          [
            callData.map((arg) => {
              return {
                target: arg.to,
                value: arg.value ?? 0n,
                callData: arg.data ?? '0x',
              }
            }),
          ],
        ),
      ],
    })
  }

  const call = callData.length === 0 ? undefined : callData[0]

  if (!call) {
    throw new Error('No calls to encode')
  }

  return encodeFunctionData({
    abi: executeAbi,
    functionName: 'execute',
    args: [
      encodeExecutionMode(mode),
      concatHex([
        call.to,
        toHex(call.value ?? 0n, { size: 32 }),
        call.data ?? '0x',
      ]),
    ],
  })
}

async function getAccountNonce(
  client: Client,
  args: GetAccountNonceParams,
): Promise<bigint> {
  const { address, entryPointAddress, key = 0n } = args

  return await getAction(
    client,
    readContract,
    'readContract',
  )({
    address: entryPointAddress,
    abi: [
      {
        inputs: [
          {
            name: 'sender',
            type: 'address',
          },
          {
            name: 'key',
            type: 'uint192',
          },
        ],
        name: 'getNonce',
        outputs: [
          {
            name: 'nonce',
            type: 'uint256',
          },
        ],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    functionName: 'getNonce',
    args: [address, key],
  })
}

function getBundlerClient(config: RhinestoneAccountConfig, client: Client) {
  function getBundlerEndpoint(config: BundlerConfig, chainId: number) {
    switch (config.type) {
      case 'pimlico':
        return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${config.apiKey}`
    }
  }

  const { bundler } = config
  const chainId = client.chain?.id
  if (!chainId) {
    throw new Error('Chain id is required')
  }

  const endpoint = bundler
    ? getBundlerEndpoint(bundler, chainId)
    : `https://public.pimlico.io/v2/${chainId}/rpc`
  return createBundlerClient({
    client,
    transport: http(endpoint),
    paymaster: true,
    userOperation: {
      estimateFeesPerGas: () => getGasPriceEstimate(endpoint),
    },
  })
}

async function getGasPriceEstimate(bundlerUrl: string) {
  const response = await fetch(bundlerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      // TODO do not rely on vendor-specific methods
      method: 'pimlico_getUserOperationGasPrice',
      params: [],
    }),
  })

  const json = (await response.json()) as UserOperationGasPriceResponse

  return {
    maxFeePerGas: BigInt(json.result.fast.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(json.result.fast.maxPriorityFeePerGas),
  }
}

export { encode7579Calls, getAccountNonce, getBundlerClient }
export type { ValidatorConfig }
