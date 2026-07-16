import type { Address } from 'viem'
import type { EvmChainReference } from '../../chains/types'
import type { ContractRead, RpcCodeResult, RpcReadContext } from './types'

export interface RpcReadPort {
  readonly getCode: (
    context: RpcReadContext,
    address: Address,
  ) => Promise<RpcCodeResult>
  readonly readContract: <TResult>(
    context: RpcReadContext,
    request: ContractRead<TResult>,
  ) => Promise<TResult>
  readonly multicall: <TResults extends readonly unknown[]>(
    context: RpcReadContext,
    requests: readonly ContractRead[],
  ) => Promise<TResults>
}

export interface RpcPort {
  readonly forChain: (chain: EvmChainReference) => RpcReadPort
}
