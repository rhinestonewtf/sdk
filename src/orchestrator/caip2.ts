// CAIP-2 wire format. Mirrors the orchestrator's caip2.ts namespace registry
// — Solana / Tron synthetic numeric ids round-trip through the same CAIP-2
// strings the orchestrator emits, so the SDK and orchestrator agree on the
// wire shape without needing the user to think about CAIP-2 themselves.
//
// Spec: https://chainagnostic.org/CAIPs/caip-2

type EvmCaip2ChainId = `eip155:${number}`
type SolanaCaip2ChainId = `solana:${string}`
type TronCaip2ChainId = `tron:${string}`
type Caip2ChainId = EvmCaip2ChainId | SolanaCaip2ChainId | TronCaip2ChainId

const EIP155_CAIP2_REGEX = /^eip155:\d+$/
const NON_EIP155_CAIP2_REGEX = /^(?:solana|tron):[-_a-zA-Z0-9]{1,32}$/

// Synthetic numeric ids ↔ CAIP-2 strings for non-eip155 chains. Must match
// the orchestrator's NON_EIP155_CAIP2_TO_ID exactly — these flow over the
// wire and any drift would cause routing failures.
const NON_EIP155_ID_TO_CAIP2: Record<number, Caip2ChainId> = {
  792703809: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  728126428: 'tron:0x2b6653dc',
}
const NON_EIP155_CAIP2_TO_ID: Record<string, number> = Object.fromEntries(
  Object.entries(NON_EIP155_ID_TO_CAIP2).map(([id, caip2]) => [
    caip2,
    Number(id),
  ]),
)

function toCaip2(chainId: number): Caip2ChainId {
  if (!Number.isInteger(chainId) || chainId < 0) {
    throw new Error(`Invalid chain id: ${chainId}`)
  }
  const nonEvm = NON_EIP155_ID_TO_CAIP2[chainId]
  if (nonEvm) return nonEvm
  return `eip155:${chainId}`
}

function fromCaip2(chainId: string): number {
  if (EIP155_CAIP2_REGEX.test(chainId)) {
    return Number(chainId.slice('eip155:'.length))
  }
  if (NON_EIP155_CAIP2_REGEX.test(chainId)) {
    const id = NON_EIP155_CAIP2_TO_ID[chainId]
    if (id !== undefined) return id
  }
  throw new Error(`Invalid CAIP-2 chain id: ${chainId}`)
}

function isCaip2(chainId: string): chainId is Caip2ChainId {
  if (EIP155_CAIP2_REGEX.test(chainId)) return true
  return chainId in NON_EIP155_CAIP2_TO_ID
}

function isEvmCaip2(chainId: string): chainId is EvmCaip2ChainId {
  return EIP155_CAIP2_REGEX.test(chainId)
}

/** True when a numeric chain id corresponds to a known non-eip155 namespace. */
function isNonEvmChainId(chainId: number): boolean {
  return chainId in NON_EIP155_ID_TO_CAIP2
}

export type {
  Caip2ChainId,
  EvmCaip2ChainId,
  SolanaCaip2ChainId,
  TronCaip2ChainId,
}
export { fromCaip2, isCaip2, isEvmCaip2, isNonEvmChainId, toCaip2 }
