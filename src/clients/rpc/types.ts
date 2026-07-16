import type { Abi, Address, Hex } from 'viem'
import type { EvmChainReference } from '../../chains/types'

export interface ContractRead<TResult = unknown> {
  readonly address: Address
  readonly abi: Abi
  readonly functionName: string
  readonly args?: readonly unknown[]
  readonly result?: TResult
}

export interface RpcReadContext {
  readonly chain: EvmChainReference
  readonly blockNumber?: bigint
}

export interface RpcCodeResult {
  readonly code?: Hex
}

export type RpcProvider =
  | { readonly kind: 'public' }
  | { readonly kind: 'alchemy'; readonly apiKey: string }
  | {
      readonly kind: 'custom'
      readonly urls: Readonly<Record<number, string>>
    }
