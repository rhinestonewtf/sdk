import type { ChainReference, EvmChainReference } from './types'

// CAIP-2 wire format. EVM chains map programmatically (`eip155:<id>`); the
// handful of non-EVM / virtual chains carry an explicit id ↔ caip2 mapping.
//
// v2: this small table is bundled here rather than read from
// `@rhinestone/shared-configs`. EVM is the common case and needs no table, so a
// new EVM chain needs no SDK change; a new non-EVM chain is rare and adds one
// entry below. Every HyperCore id is EVM-*settled*, so `isNonEvmChainId` is
// `false` for all of them even though their wire ids are the non-`eip155`
// `hypercore:` namespace.
//
// This table is TRANSLATION, not policy: it answers "what number is this wire
// id", and adding an entry does not make that chain a legal destination. Which
// HyperCore ids you may TARGET is `HyperCoreCaip2ChainId` and the exported
// descriptors — only the two venues. `hypercore:mainnet` is here because it is a
// real chain (the Core L1, where deposits originate) that can appear in a
// response we have to parse; it is not an addressable target (RHI-5510).
//
// Spec: https://chainagnostic.org/CAIPs/caip-2
const NON_EVM_CHAINS = [
  { id: 1337, caip2: 'hypercore:mainnet', nonEvm: false },
  { id: 1337001, caip2: 'hypercore:spot', nonEvm: false },
  { id: 1337002, caip2: 'hypercore:perp', nonEvm: false },
  { id: 728126428, caip2: 'tron:mainnet', nonEvm: true },
  {
    id: 792703809,
    caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    nonEvm: true,
  },
  { id: 1500148, caip2: 'stellar:pubnet', nonEvm: true },
] as const satisfies ReadonlyArray<{
  id: number
  caip2: string
  nonEvm: boolean
}>

const HYPERCORE_WIRE_IDS: ReadonlySet<number> = new Set(
  NON_EVM_CHAINS.filter((chain) => chain.caip2.startsWith('hypercore:')).map(
    (chain) => chain.id,
  ),
)

/**
 * True when a chain id's wire form is in the `hypercore:` namespace.
 *
 * This is the one combination the `caip2.startsWith('eip155:')` test gets wrong:
 * HyperCore is EVM-*addressed* (hex recipients, EIP-712 signing) while its wire
 * id is not `eip155:`, so every place that decides "is this reference EVM" must
 * ask this too. Two places did it as `chainId === 1337`, which silently became
 * wrong the moment HyperCore gained a second id — derived from the table here so
 * a third venue cannot reintroduce it.
 *
 * NOT the same as `isHyperCoreChainId` in `@rhinestone/shared-configs`, which
 * answers "is this a delivery VENUE" and is deliberately false for the Core L1.
 * This one is about address shape, so it is true for all three.
 */
export function isHyperCoreWireId(chainId: number): boolean {
  return HYPERCORE_WIRE_IDS.has(chainId)
}

const evmPattern = /^eip155:(0|[1-9]\d*)$/

export function formatCaip2(chainId: number): string {
  if (!Number.isSafeInteger(chainId) || chainId < 0) {
    throw new Error(`Invalid chain id: ${chainId}`)
  }
  const nonEvm = NON_EVM_CHAINS.find((chain) => chain.id === chainId)
  return nonEvm ? nonEvm.caip2 : `eip155:${chainId}`
}

export function chainIdFromCaip2(value: string): number | undefined {
  if (evmPattern.test(value)) {
    return Number(value.slice('eip155:'.length))
  }
  return NON_EVM_CHAINS.find((chain) => chain.caip2 === value)?.id
}

export function parseCaip2(value: string): ChainReference {
  if (evmPattern.test(value)) {
    const id = Number(value.slice('eip155:'.length))
    return { kind: 'evm', id, caip2: `eip155:${id}` }
  }
  const id = chainIdFromCaip2(value)
  if (id === undefined) {
    throw new Error(`Invalid CAIP-2 chain id: ${value}`)
  }
  if (!isNonEvmChainId(id)) {
    return { kind: 'evm', id, caip2: value as `eip155:${number}` }
  }
  const separator = value.indexOf(':')
  return {
    kind: 'non-evm',
    namespace: value.slice(0, separator),
    reference: value.slice(separator + 1),
    caip2: value as `${string}:${string}`,
  }
}

export function toEvmChainReference(chainId: number): EvmChainReference {
  const caip2 = formatCaip2(chainId)
  if (!caip2.startsWith('eip155:') && !isHyperCoreWireId(chainId)) {
    throw new Error(`Chain ${chainId} is not EVM-compatible`)
  }
  return {
    kind: 'evm',
    id: chainId,
    caip2: caip2 as `eip155:${number}`,
  }
}

export function chainIdFromReference(chain: ChainReference): number {
  if (chain.kind === 'evm') return chain.id
  const id = chainIdFromCaip2(chain.caip2)
  if (id === undefined) {
    throw new Error(`Invalid CAIP-2 chain id: ${chain.caip2}`)
  }
  return id
}

export function isCaip2(value: string): boolean {
  return evmPattern.test(value) || chainIdFromCaip2(value) !== undefined
}

export function isEvmCaip2(value: string): value is `eip155:${number}` {
  return evmPattern.test(value)
}

// True when a numeric chain id is genuinely non-EVM (Solana / Tron / Stellar). Every
// HyperCore id is EVM-settled, so this is `false` for all of them even though
// their wire ids are in the non-`eip155` `hypercore:` namespace.
export function isNonEvmChainId(chainId: number): boolean {
  return NON_EVM_CHAINS.some((chain) => chain.id === chainId && chain.nonEvm)
}
