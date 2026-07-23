import type { Address, Hex } from 'viem'
import type { EvmChainReference } from '../../../chains/types'
import type { RpcReadPort } from '../../../clients/rpc/port'
import { getPermissionId } from './digest'
import { getSmartSessionEmissaryAddress } from './module'
import type { Session } from './types'

const permissionEnabledAbi = [
  {
    type: 'function',
    name: 'isPermissionEnabled',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'permissionId', type: 'bytes32' },
    ],
    outputs: [{ name: 'isEnabled', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

const nonceAbi = [
  {
    type: 'function',
    name: 'getNonce',
    inputs: [
      { name: 'sponsor', type: 'address' },
      { name: 'lockTag', type: 'bytes12' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export async function readSessionEnabled(input: {
  readonly rpc: RpcReadPort
  readonly chain: EvmChainReference
  readonly account: Address
  readonly session: Session
  readonly environment: 'production' | 'development'
}): Promise<boolean> {
  return input.rpc.readContract<boolean>(
    { chain: input.chain },
    {
      address: getSmartSessionEmissaryAddress(input.environment),
      abi: permissionEnabledAbi,
      functionName: 'isPermissionEnabled',
      args: [input.account, getPermissionId(input.session)],
    },
  )
}

export async function readSessionNonce(input: {
  readonly rpc: RpcReadPort
  readonly chain: EvmChainReference
  readonly account: Address
  readonly lockTag: Hex
  readonly environment: 'production' | 'development'
}): Promise<bigint> {
  return input.rpc.readContract<bigint>(
    { chain: input.chain },
    {
      address: getSmartSessionEmissaryAddress(input.environment),
      abi: nonceAbi,
      functionName: 'getNonce',
      args: [input.account, input.lockTag],
    },
  )
}
