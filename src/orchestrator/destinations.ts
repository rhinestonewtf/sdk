// Non-EVM destination chain descriptors. Mirrors the minimal shape of viem's
// `Chain` (id, name, nativeCurrency) so callers can pass them anywhere a
// destination chain is expected — `targetChain: solanaMainnet` reads the
// same as `targetChain: optimism`.
//
// The `kind` field discriminates these from viem `Chain` objects; viem
// chains don't carry a `kind` field, so `'kind' in targetChain` (or the
// helper below) cleanly narrows the union.
//
// `id` is a synthetic numeric chain id matched to the orchestrator's
// internal id registry — it can be passed wherever `chainId: number` is
// expected (round-trips through `toCaip2` to the wire CAIP-2 string).

import type { Caip2ChainId } from './caip2'
import { isNonEvmChainId } from './caip2'

interface NativeCurrency {
  readonly name: string
  readonly symbol: string
  readonly decimals: number
}

interface DestinationChain {
  readonly id: number
  readonly name: string
  readonly caip2: Caip2ChainId
  readonly kind: 'svm' | 'tvm'
  readonly nativeCurrency: NativeCurrency
  readonly testnet?: boolean
}

const solanaMainnet: DestinationChain = {
  id: 792703809,
  name: 'Solana',
  caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  kind: 'svm',
  nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
}

const tronMainnet: DestinationChain = {
  id: 728126428,
  name: 'Tron',
  caip2: 'tron:0x2b6653dc',
  kind: 'tvm',
  nativeCurrency: { name: 'Tron', symbol: 'TRX', decimals: 6 },
}

/**
 * Narrow a `Chain | DestinationChain` to the non-EVM variant. Uses the
 * synthetic chain-id registry rather than structural narrowing so it
 * stays robust against future additions to viem's Chain shape.
 */
function isDestinationChain(
  chain: { id: number } & object,
): chain is DestinationChain {
  return isNonEvmChainId(chain.id)
}

export type { DestinationChain, NativeCurrency }
export { isDestinationChain, solanaMainnet, tronMainnet }
