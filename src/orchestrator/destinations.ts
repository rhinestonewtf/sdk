// Public non-EVM destination chain descriptors. Mirrors the minimal shape
// of viem's `Chain` (name, nativeCurrency) so callers can pass them
// anywhere a destination chain is expected — `targetChain: solanaMainnet`
// reads the same as `targetChain: optimism`.
//
// The `kind` field discriminates these from viem `Chain` objects; viem
// chains don't carry a `kind` field, so the `isNonEvmChain` helper
// narrows a `Chain | NonEvmChain` union structurally.
//
// The wire format is the CAIP-2 string. Internally the SDK and the
// orchestrator also use a synthetic numeric chain id derived from the
// CAIP-2 mapping, but it is non-standard and intentionally not exposed
// on this type — use `getChainId` if you need a numeric id.

import type { Chain } from 'viem'
import type { Caip2ChainId } from './caip2'
import { fromCaip2 } from './caip2'

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
  readonly kind: 'svm' | 'tvm'
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
  caip2: 'tron:0x2b6653dc',
  kind: 'tvm',
  nativeCurrency: { name: 'Tron', symbol: 'TRX', decimals: 6 },
}

function isNonEvmChain(chain: DestinationChain): chain is NonEvmChain {
  return 'kind' in chain && (chain.kind === 'svm' || chain.kind === 'tvm')
}

// Numeric chain id for either chain kind. EVM uses viem's `id`; non-EVM
// derives the synthetic id from the CAIP-2 string. Used for the wire
// format and for SDK-internal lookups keyed by chain id.
function getChainId(chain: DestinationChain): number {
  return isNonEvmChain(chain) ? fromCaip2(chain.caip2) : chain.id
}

export type { DestinationChain, NativeCurrency, NonEvmAddress, NonEvmChain }
export { getChainId, isNonEvmChain, solanaMainnet, tronMainnet }
