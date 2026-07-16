import type { Address } from 'viem'

export interface EvmChainReference {
  readonly kind: 'evm'
  readonly id: number
  readonly caip2: `eip155:${number}`
}

export interface NonEvmChainReference {
  readonly kind: 'non-evm'
  readonly namespace: string
  readonly reference: string
  readonly caip2: `${string}:${string}`
}

export type ChainReference = EvmChainReference | NonEvmChainReference

export interface EvmTokenReference {
  readonly kind: 'evm-token'
  readonly chain: EvmChainReference
  readonly address: Address
}

export interface NonEvmTokenReference {
  readonly kind: 'non-evm-token'
  readonly chain: NonEvmChainReference
  readonly address: string
}

export type TokenReference = EvmTokenReference | NonEvmTokenReference
