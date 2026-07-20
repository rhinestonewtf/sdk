// Public destination chain descriptors for destinations that aren't a plain
// viem `Chain`: the non-EVM chains (Solana, Tron) plus HyperCore (an EVM-settled
// virtual L1). Mirrors the minimal shape of viem's `Chain` (name,
// nativeCurrency) so callers can pass them anywhere a destination chain is
// expected — `targetChain: solanaMainnet` reads the same as `targetChain:
// optimism`.
//
// The wire format is the CAIP-2 string. Internally the SDK and the
// orchestrator also use a synthetic numeric chain id derived from the
// CAIP-2 mapping, but it is non-standard and intentionally not exposed
// on this type.

import type { Chain } from 'viem'

type EvmCaip2ChainId = `eip155:${number}`
type SolanaCaip2ChainId = `solana:${string}`
type TronCaip2ChainId = `tron:${string}`
type HyperCoreCaip2ChainId = 'hypercore:mainnet'
type Caip2ChainId =
  | EvmCaip2ChainId
  | SolanaCaip2ChainId
  | TronCaip2ChainId
  | HyperCoreCaip2ChainId

interface NativeCurrency {
  readonly name: string
  readonly symbol: string
  readonly decimals: number
}

// Non-EVM (Solana base58 / Tron T-prefix) addresses don't satisfy viem's
// `Address` template literal. Typed as bare `string` since the shape is
// chain-namespace specific; the orchestrator validates the format against
// the destination's CAIP-2 namespace.
type NonEvmAddress = string

interface NonEvmChain {
  readonly name: string
  readonly caip2: Caip2ChainId
  // 'svm' (Solana) / 'tvm' (Tron) are non-EVM VMs; 'hypercore' is an EVM-settled
  // virtual L1. All three are solver-mediated destinations with no user-signed
  // destination session.
  readonly kind: 'svm' | 'tvm' | 'hypercore'
  readonly nativeCurrency: NativeCurrency
  readonly testnet?: boolean
}

type DestinationChain = Chain | NonEvmChain

const solanaMainnet: NonEvmChain = {
  name: 'Solana',
  caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  kind: 'svm',
  nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
}

const tronMainnet: NonEvmChain = {
  name: 'Tron',
  caip2: 'tron:mainnet',
  kind: 'tvm',
  nativeCurrency: { name: 'Tron', symbol: 'TRX', decimals: 6 },
}

const hyperCoreMainnet: NonEvmChain = {
  name: 'HyperCore',
  caip2: 'hypercore:mainnet',
  kind: 'hypercore',
  nativeCurrency: { name: 'Hyperliquid', symbol: 'HYPE', decimals: 18 },
}

export type { DestinationChain, NativeCurrency, NonEvmAddress, NonEvmChain }
export { hyperCoreMainnet, solanaMainnet, tronMainnet }
