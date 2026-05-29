import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import {
  getChainId,
  hyperCoreMainnet,
  isNonEvmChain,
  solanaMainnet,
  tronMainnet,
} from './destinations'

describe('isNonEvmChain', () => {
  test('true for any descriptor-addressed destination (svm/tvm/hypercore)', () => {
    expect(isNonEvmChain(solanaMainnet)).toBe(true)
    expect(isNonEvmChain(tronMainnet)).toBe(true)
    expect(isNonEvmChain(hyperCoreMainnet)).toBe(true)
  })

  test('false for a plain viem Chain', () => {
    expect(isNonEvmChain(base)).toBe(false)
  })
})

describe('getChainId', () => {
  test('viem Chain uses its numeric id', () => {
    expect(getChainId(base)).toBe(base.id)
  })

  test('Solana / Tron resolve to their synthetic ids', () => {
    expect(getChainId(solanaMainnet)).toBe(792703809)
    expect(getChainId(tronMainnet)).toBe(728126428)
  })

  // HyperCore is addressed by its virtual id 1337 on the wire; the orchestrator
  // maps 1337 -> 999 (HyperEVM) for settlement.
  test('HyperCore resolves to the virtual id 1337', () => {
    expect(getChainId(hyperCoreMainnet)).toBe(1337)
  })
})

describe('hyperCoreMainnet descriptor', () => {
  test('is an EVM-settled virtual destination addressed by eip155:1337', () => {
    expect(hyperCoreMainnet.kind).toBe('hypercore')
    expect(hyperCoreMainnet.caip2).toBe('eip155:1337')
  })
})
