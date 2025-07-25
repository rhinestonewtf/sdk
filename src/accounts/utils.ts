import type { Address, Chain, Client, Hex, Transport } from 'viem'
import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  http,
  toBytes,
  toHex,
} from 'viem'
import {
  createBundlerClient,
  createPaymasterClient,
} from 'viem/account-abstraction'
import { readContract } from 'viem/actions'
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  sepolia,
  soneium,
  zksync,
} from 'viem/chains'
import { getAction } from 'viem/utils'
import type { SupportedChain } from '../orchestrator'
import type {
  BundlerConfig,
  PaymasterConfig,
  ProviderConfig,
  RhinestoneAccountConfig,
} from '../types'

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
      case 'biconomy':
        return `https://bundler.biconomy.io/api/v3/${chainId}/${config.apiKey}`
    }
  }

  function getPaymasterEndpoint(config: PaymasterConfig, chainId: number) {
    switch (config.type) {
      case 'pimlico':
        return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${config.apiKey}`
      case 'biconomy':
        return `https://paymaster.biconomy.io/api/v2/${chainId}/${config.apiKey}`
    }
  }

  const { bundler, paymaster } = config
  const chainId = client.chain?.id
  if (!chainId) {
    throw new Error('Chain id is required')
  }

  const endpoint = bundler
    ? getBundlerEndpoint(bundler, chainId)
    : `https://public.pimlico.io/v2/${chainId}/rpc`
  const paymasterEndpoint = paymaster
    ? getPaymasterEndpoint(paymaster, chainId)
    : undefined
  return createBundlerClient({
    client,
    transport: http(endpoint),
    paymaster: paymasterEndpoint
      ? createPaymasterClient({
          transport: http(paymasterEndpoint),
        })
      : undefined,
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

function createTransport(chain: Chain, provider?: ProviderConfig): Transport {
  if (!provider) {
    return http()
  }

  switch (provider.type) {
    case 'alchemy': {
      const alchemyNetwork = getAlchemyNetworkName(chain.id as SupportedChain)
      const jsonRpcEndpoint = `https://${alchemyNetwork}.g.alchemy.com/v2/${provider.apiKey}`
      return http(jsonRpcEndpoint)
    }
  }
}

function getAlchemyNetworkName(chainId: SupportedChain): string {
  switch (chainId) {
    case mainnet.id:
      return 'eth-mainnet'
    case sepolia.id:
      return 'eth-sepolia'
    case polygon.id:
      return 'polygon-mainnet'
    case optimism.id:
      return 'opt-mainnet'
    case optimismSepolia.id:
      return 'opt-sepolia'
    case arbitrum.id:
      return 'arb-mainnet'
    case arbitrumSepolia.id:
      return 'arb-sepolia'
    case base.id:
      return 'base-mainnet'
    case baseSepolia.id:
      return 'base-sepolia'
    case zksync.id:
      return 'zksync-mainnet'
    case soneium.id:
      return 'soneium-mainnet'
  }
}

export { encode7579Calls, getAccountNonce, getBundlerClient, createTransport }
export type { ValidatorConfig }
