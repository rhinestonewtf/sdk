// CAIP-2 wire format. The namespace ↔ numeric-id mapping is owned by
// `@rhinestone/shared-configs` (the same source the orchestrator uses), so the
// SDK and orchestrator can't drift on the wire shape — adding a chain is a
// shared-configs registry entry, not a hand-maintained table in each repo.
// HyperCore is a first-class `virtual` registry entry there: its canonical id
// is `hypercore:mainnet` (EVM-settled, so `isNonEvmChainId(1337) === false`).
//
// Spec: https://chainagnostic.org/CAIPs/caip-2

import {
  chainIdFromCaip2,
  getCaip2,
  isNonEvmChainId as isNonEvmChainIdFromRegistry,
} from '@rhinestone/shared-configs'

type EvmCaip2ChainId = `eip155:${number}`
type SolanaCaip2ChainId = `solana:${string}`
type TronCaip2ChainId = `tron:${string}`
type HyperCoreCaip2ChainId = 'hypercore:mainnet'
type Caip2ChainId =
  | EvmCaip2ChainId
  | SolanaCaip2ChainId
  | TronCaip2ChainId
  | HyperCoreCaip2ChainId

const EIP155_CAIP2_REGEX = /^eip155:\d+$/

function toCaip2(chainId: number): Caip2ChainId {
  if (!Number.isInteger(chainId) || chainId < 0) {
    throw new Error(`Invalid chain id: ${chainId}`)
  }
  // `getCaip2` returns the registry-declared caip2 (Solana/Tron/HyperCore) or
  // the `eip155:<id>` fallback for plain EVM chains.
  return getCaip2(chainId) as Caip2ChainId
}

function fromCaip2(chainId: string): number {
  // eip155 references aren't registry-backed (they compose programmatically),
  // so parse them numerically here. This also keeps accepting the legacy
  // `eip155:1337` HyperCore id for back-compat.
  if (EIP155_CAIP2_REGEX.test(chainId)) {
    return Number(chainId.slice('eip155:'.length))
  }
  const id = chainIdFromCaip2(chainId)
  if (id !== undefined) return id
  throw new Error(`Invalid CAIP-2 chain id: ${chainId}`)
}

function isCaip2(chainId: string): chainId is Caip2ChainId {
  if (EIP155_CAIP2_REGEX.test(chainId)) return true
  return chainIdFromCaip2(chainId) !== undefined
}

function isEvmCaip2(chainId: string): chainId is EvmCaip2ChainId {
  return EIP155_CAIP2_REGEX.test(chainId)
}

/**
 * True when a numeric chain id is genuinely non-EVM (Solana / Tron). HyperCore
 * (1337) is EVM-settled, so this is `false` for it even though its wire id is
 * the non-eip155 `hypercore:mainnet` namespace — `registry.ts` /
 * `execution/utils.ts` rely on HyperCore being EVM-classified here. Sourced
 * from the shared-configs registry `vmType`.
 */
function isNonEvmChainId(chainId: number): boolean {
  return isNonEvmChainIdFromRegistry(chainId)
}

export type {
  Caip2ChainId,
  EvmCaip2ChainId,
  SolanaCaip2ChainId,
  TronCaip2ChainId,
  HyperCoreCaip2ChainId,
}
export { fromCaip2, isCaip2, isEvmCaip2, isNonEvmChainId, toCaip2 }
