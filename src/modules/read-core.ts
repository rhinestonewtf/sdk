import { type Address, encodeAbiParameters, type Hex } from 'viem'
import type { EvmChainReference } from '../chains/types'
import type { RpcReadPort } from '../clients/rpc/port'
import type { ModuleKind, ResolvedModule } from './types'
import { ENS_HCA_MODULE } from './validators/ens'
import { OWNABLE_VALIDATOR_ADDRESS } from './validators/ownable'

const sentinel = '0x0000000000000000000000000000000000000001' as const

const paginationAbi = (
  name: 'getValidatorsPaginated' | 'getExecutorsPaginated',
) =>
  [
    {
      name,
      type: 'function',
      inputs: [
        { name: 'cursor', type: 'address' },
        { name: 'size', type: 'uint256' },
      ],
      outputs: [
        { name: 'array', type: 'address[]' },
        { name: 'next', type: 'address' },
      ],
      stateMutability: 'view',
    },
  ] as const

export async function readInstalledModules(input: {
  readonly rpc: RpcReadPort
  readonly chain: EvmChainReference
  readonly accountKind: string
  readonly account: Address
  readonly kind: Extract<ModuleKind, 'validator' | 'executor'>
}): Promise<readonly Address[]> {
  if (input.accountKind === 'eoa') return []
  if (input.accountKind === 'kernel') throw new Error('Kernel not supported')
  const functionName =
    input.kind === 'validator'
      ? 'getValidatorsPaginated'
      : 'getExecutorsPaginated'
  const result = await input.rpc.readContract<
    readonly [readonly Address[], Address]
  >(
    { chain: input.chain },
    {
      address: input.account,
      abi: paginationAbi(functionName),
      functionName,
      args: [sentinel, 100n],
    },
  )
  return result[0]
}

export async function readValidatorInitialized(input: {
  readonly rpc: RpcReadPort
  readonly chain: EvmChainReference
  readonly account: Address
  readonly validator: Address
}): Promise<boolean> {
  return input.rpc.readContract<boolean>(
    { chain: input.chain },
    {
      address: input.validator,
      abi: [
        {
          name: 'isInitialized',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'smartAccount', type: 'address' }],
          outputs: [{ name: '', type: 'bool' }],
        },
      ],
      functionName: 'isInitialized',
      args: [input.account],
    },
  )
}

export async function readOwners(input: {
  readonly rpc: RpcReadPort
  readonly chain: EvmChainReference
  readonly accountKind: string
  readonly account: Address
  readonly hcaFactory?: Address
}): Promise<{
  readonly accounts: readonly Address[]
  readonly threshold: number
} | null> {
  let validator: Address = OWNABLE_VALIDATOR_ADDRESS
  if (input.accountKind === 'hca') {
    validator = input.hcaFactory
      ? await input.rpc.readContract<Address>(
          { chain: input.chain },
          {
            address: input.hcaFactory,
            abi: [
              {
                name: 'initDataParser',
                type: 'function',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ name: '', type: 'address' }],
              },
            ],
            functionName: 'initDataParser',
          },
        )
      : ENS_HCA_MODULE
  }
  const results = await input.rpc.multicall<
    readonly [
      { readonly result?: readonly Address[]; readonly error?: unknown },
      { readonly result?: bigint; readonly error?: unknown },
    ]
  >({ chain: input.chain }, [
    {
      address: validator,
      abi: [
        {
          name: 'getOwners',
          type: 'function',
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [{ name: '', type: 'address[]' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'getOwners',
      args: [input.account],
    },
    {
      address: validator,
      abi: [
        {
          name: 'threshold',
          type: 'function',
          inputs: [{ name: 'module', type: 'address' }],
          outputs: [{ name: '', type: 'uint256' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'threshold',
      args: [input.account],
    },
  ])
  const [owners, threshold] = results
  if (
    owners.error ||
    threshold.error ||
    !owners.result ||
    threshold.result === undefined
  ) {
    return null
  }
  return { accounts: owners.result, threshold: Number(threshold.result) }
}

export function encodeAccountModuleDeInitData(input: {
  readonly accountKind: string
  readonly module: ResolvedModule
  readonly installed: readonly Address[]
}): Hex {
  if (
    input.module.kind !== 'validator' ||
    !['nexus', 'safe', 'startale'].includes(input.accountKind)
  ) {
    return input.module.deInitData
  }
  const index = input.installed.findIndex(
    (address) => address.toLowerCase() === input.module.address.toLowerCase(),
  )
  if (index < 0) return input.module.deInitData
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [
      index === 0 ? sentinel : input.installed[index - 1],
      input.module.deInitData,
    ],
  )
}
