// Public destination chain descriptors for destinations that aren't a plain
// viem `Chain`: the non-EVM chains (Solana, Tron, Stellar) plus HyperCore (an
// EVM-settled
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

type SolanaCaip2ChainId = `solana:${string}`
type TronCaip2ChainId = `tron:${string}`
type StellarCaip2ChainId = `stellar:${string}`
// One id per HyperCore delivery venue — the venue is the destination, not a
// flag on the token request (RHI-5510).
type HyperCoreCaip2ChainId = 'hypercore:spot' | 'hypercore:perp'
interface NativeCurrency {
  readonly name: string
  readonly symbol: string
  readonly decimals: number
}

// Non-EVM (Solana base58 / Tron T-prefix / Stellar base32 strkey) addresses
// don't satisfy viem's `Address` template literal. Typed as bare `string` since
// the shape is chain-namespace specific; the orchestrator validates the format
// against the destination's CAIP-2 namespace.
type NonEvmAddress = string

declare const solanaAddressBrand: unique symbol

/** A canonical base58-encoded 32-byte Solana address. */
type SolanaAddress = string & { readonly [solanaAddressBrand]: true }

interface NonEvmChainBase {
  readonly name: string
  readonly nativeCurrency: NativeCurrency
  readonly testnet?: boolean
}

interface SolanaChain extends NonEvmChainBase {
  readonly caip2: SolanaCaip2ChainId
  readonly kind: 'svm'
}

interface TronChain extends NonEvmChainBase {
  readonly caip2: TronCaip2ChainId
  readonly kind: 'tvm'
}

interface StellarChain extends NonEvmChainBase {
  readonly caip2: StellarCaip2ChainId
  readonly kind: 'stellar'
}

interface HyperCoreChain extends NonEvmChainBase {
  readonly caip2: HyperCoreCaip2ChainId
  readonly kind: 'hypercore'
}

type NonEvmChain = SolanaChain | TronChain | StellarChain | HyperCoreChain
type DestinationChain = Chain | NonEvmChain

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** Validate and brand a canonical Solana address. */
function solanaAddress(value: string): SolanaAddress {
  if (!value) throw new TypeError('Invalid Solana address: expected 32 bytes')
  let number = 0n
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character)
    if (digit < 0) {
      throw new TypeError('Invalid Solana address: expected canonical base58')
    }
    number = number * 58n + BigInt(digit)
  }
  let decodedLength = 0
  for (let remaining = number; remaining > 0n; remaining >>= 8n) decodedLength++
  const leadingZeroes = value.length - value.replace(/^1+/, '').length
  if (decodedLength + leadingZeroes !== 32) {
    throw new TypeError('Invalid Solana address: expected 32 bytes')
  }
  return value as SolanaAddress
}

const solanaMainnet = {
  name: 'Solana',
  caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  kind: 'svm',
  nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
} satisfies SolanaChain

const tronMainnet = {
  name: 'Tron',
  caip2: 'tron:mainnet',
  kind: 'tvm',
  nativeCurrency: { name: 'Tron', symbol: 'TRX', decimals: 6 },
} satisfies TronChain

// Stellar addresses classic assets through Soroban contracts, so a token
// request carries the asset's Stellar Asset Contract (a `C…` strkey) while the
// recipient is an account (`G…`) — two different shapes in the same namespace.
const stellarMainnet = {
  name: 'Stellar',
  caip2: 'stellar:pubnet',
  kind: 'stellar',
  nativeCurrency: { name: 'Lumen', symbol: 'XLM', decimals: 7 },
} satisfies StellarChain

// A HyperCore deposit credits one of two accounts that are not
// interchangeable: the recipient's spot wallet, or the default perp dex's
// margin account. `CoreDepositWallet.depositFor` selects between them, and the
// wrong choice is invisible — the intent completes, the fill succeeds, and only
// the recipient's Core state shows where the funds went. So the venue is the
// destination you address, not an optional field that four separate
// field-by-field rebuilds could each silently drop (RHI-5510).
const hyperCoreSpot = {
  name: 'HyperCore Spot',
  caip2: 'hypercore:spot',
  kind: 'hypercore',
  nativeCurrency: { name: 'Hyperliquid', symbol: 'HYPE', decimals: 18 },
} satisfies HyperCoreChain

const hyperCorePerp = {
  name: 'HyperCore Perp',
  caip2: 'hypercore:perp',
  kind: 'hypercore',
  nativeCurrency: { name: 'Hyperliquid', symbol: 'HYPE', decimals: 18 },
} satisfies HyperCoreChain

export type {
  DestinationChain,
  HyperCoreChain,
  NativeCurrency,
  NonEvmAddress,
  NonEvmChain,
  SolanaAddress,
  SolanaChain,
  StellarChain,
  TronChain,
}
export {
  hyperCorePerp,
  hyperCoreSpot,
  solanaAddress,
  solanaMainnet,
  stellarMainnet,
  tronMainnet,
}
