// CAIP-2 wire format. EVM chains map programmatically (`eip155:<id>`); the
// handful of non-EVM / virtual chains carry an explicit id ↔ caip2 mapping.
//
// v2: this small table is bundled here rather than read from
// `@rhinestone/shared-configs`. EVM is the common case and needs no table, so a
// new EVM chain needs no SDK change; a new non-EVM chain is rare and adds one
// entry below. HyperCore is EVM-settled (id 1337) so `isNonEvmChainId` is
// `false` for it even though its wire id is the non-`eip155` `hypercore:mainnet`.
//
// Spec: https://chainagnostic.org/CAIPs/caip-2

type EvmCaip2ChainId = `eip155:${number}`
type SolanaCaip2ChainId = `solana:${string}`
type TronCaip2ChainId = `tron:${string}`
type HyperCoreCaip2ChainId = 'hypercore:mainnet'
type Caip2ChainId =
  | EvmCaip2ChainId
  | SolanaCaip2ChainId
  | TronCaip2ChainId
  | HyperCoreCaip2ChainId

// Non-`eip155` chains. `nonEvm` distinguishes genuinely non-EVM VMs
// (Solana/Tron) from EVM-settled virtual chains (HyperCore) — see
// `isNonEvmChainId`.
const NON_EVM_CHAINS = [
  { id: 1337, caip2: 'hypercore:mainnet', nonEvm: false },
  { id: 728126428, caip2: 'tron:mainnet', nonEvm: true },
  {
    id: 792703809,
    caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    nonEvm: true,
  },
] as const satisfies ReadonlyArray<{
  id: number
  caip2: Caip2ChainId
  nonEvm: boolean
}>

const EIP155_CAIP2_REGEX = /^eip155:\d+$/

function toCaip2(chainId: number): Caip2ChainId {
  if (!Number.isInteger(chainId) || chainId < 0) {
    throw new Error(`Invalid chain id: ${chainId}`)
  }
  const nonEvm = NON_EVM_CHAINS.find((c) => c.id === chainId)
  return nonEvm ? nonEvm.caip2 : `eip155:${chainId}`
}

function fromCaip2(chainId: string): number {
  // eip155 references compose programmatically. This also keeps accepting the
  // legacy `eip155:1337` HyperCore id for back-compat.
  if (EIP155_CAIP2_REGEX.test(chainId)) {
    return Number(chainId.slice('eip155:'.length))
  }
  const entry = NON_EVM_CHAINS.find((c) => c.caip2 === chainId)
  if (entry) return entry.id
  throw new Error(`Invalid CAIP-2 chain id: ${chainId}`)
}

function isCaip2(chainId: string): chainId is Caip2ChainId {
  if (EIP155_CAIP2_REGEX.test(chainId)) return true
  return NON_EVM_CHAINS.some((c) => c.caip2 === chainId)
}

function isEvmCaip2(chainId: string): chainId is EvmCaip2ChainId {
  return EIP155_CAIP2_REGEX.test(chainId)
}

/**
 * True when a numeric chain id is genuinely non-EVM (Solana / Tron). HyperCore
 * (1337) is EVM-settled, so this is `false` for it even though its wire id is
 * the non-`eip155` `hypercore:mainnet` namespace.
 */
function isNonEvmChainId(chainId: number): boolean {
  return NON_EVM_CHAINS.some((c) => c.id === chainId && c.nonEvm)
}

export type {
  Caip2ChainId,
  EvmCaip2ChainId,
  SolanaCaip2ChainId,
  TronCaip2ChainId,
  HyperCoreCaip2ChainId,
}
export { fromCaip2, isCaip2, isEvmCaip2, isNonEvmChainId, toCaip2 }
