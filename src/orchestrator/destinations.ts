// Public destination chain descriptors for destinations that aren't a plain
// viem `Chain`: the non-EVM chains (Solana, Tron) plus HyperCore (an EVM-settled
// virtual L1). Mirrors the minimal shape of viem's `Chain` (name,
// nativeCurrency) so callers can pass them anywhere a destination chain is
// expected — `targetChain: solanaMainnet` reads the same as `targetChain:
// optimism`.
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
  // 'svm' (Solana) / 'tvm' (Tron) are non-EVM VMs; 'hypercore' is an EVM-settled
  // virtual L1. All three are solver-mediated destinations with no user-signed
  // destination session — see `isNonEvmChain`.
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
  caip2: 'tron:0x2b6653dc',
  kind: 'tvm',
  nativeCurrency: { name: 'Tron', symbol: 'TRX', decimals: 6 },
}

// HyperCore is Hyperliquid's virtual trading L1 (chain id 1337). Unlike Solana
// and Tron it settles on an EVM chain (HyperEVM, 999), but the deposit is
// solver-mediated: the orchestrator builds the core-deposit executions and the
// user signs no destination session, so it belongs with the descriptor-addressed
// destinations rather than the standard EVM signing path. The CAIP-2 reference
// is the virtual id; the orchestrator maps 1337 → 999 for settlement.
const hyperCoreMainnet: NonEvmChain = {
  name: 'HyperCore',
  caip2: 'eip155:1337',
  kind: 'hypercore',
  nativeCurrency: { name: 'Hyperliquid', symbol: 'HYPE', decimals: 18 },
}

// True for any descriptor-addressed destination (Solana, Tron, HyperCore) as
// opposed to a plain viem `Chain`. viem chains carry no `kind` field, so the
// presence of `kind` is the structural discriminator — and every such
// destination is solver-mediated (no user-signed destination session, no
// destination-side validator), which is what every caller keys off.
function isNonEvmChain(chain: DestinationChain): chain is NonEvmChain {
  return 'kind' in chain
}

// Numeric chain id for either chain kind. EVM uses viem's `id`; non-EVM
// derives the synthetic id from the CAIP-2 string. Used for the wire
// format and for SDK-internal lookups keyed by chain id.
function getChainId(chain: DestinationChain): number {
  return isNonEvmChain(chain) ? fromCaip2(chain.caip2) : chain.id
}

export type { DestinationChain, NativeCurrency, NonEvmAddress, NonEvmChain }
export {
  getChainId,
  hyperCoreMainnet,
  isNonEvmChain,
  solanaMainnet,
  tronMainnet,
}
