import {
  chainIdFromCaip2,
  getCaip2,
  isNonEvmChainId as isRegistryNonEvmChainId,
} from '@rhinestone/shared-configs'
import type { ChainReference, EvmChainReference } from './types'

const evmPattern = /^eip155:(0|[1-9]\d*)$/

export function formatCaip2(chainId: number): string {
  if (!Number.isSafeInteger(chainId) || chainId < 0) {
    throw new Error(`Invalid chain id: ${chainId}`)
  }
  return getCaip2(chainId)
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
  if (!isRegistryNonEvmChainId(id)) {
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
  if (!caip2.startsWith('eip155:') && chainId !== 1337) {
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

export function isNonEvmChainId(chainId: number): boolean {
  return isRegistryNonEvmChainId(chainId)
}
