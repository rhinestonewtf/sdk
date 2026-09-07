import type { TypedDataDefinition } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  accountChainIdFromOrigins,
  originChainId,
  signatureSpansMultipleChains,
} from './origin-chain'

const verifyingContract = '0x0000000000000000000000000000000000000001' as const

const singleChainOps = {
  domain: { chainId: 8453, verifyingContract },
  types: { SingleChainOps: [{ name: 'nonce', type: 'uint256' }] },
  primaryType: 'SingleChainOps',
  message: { nonce: 1n },
} as const satisfies TypedDataDefinition

// No `chainId` in the domain — the contract verifies this one with
// `_hashTypedDataSansChainId` so that one signature covers every leg.
const multiChainOps = {
  domain: { name: 'IntentExecutor', version: 'v0.0.1', verifyingContract },
  types: {
    MultiChainOps: [
      { name: 'account', type: 'address' },
      { name: 'ops', type: 'ChainOps[]' },
    ],
    ChainOps: [
      { name: 'chainId', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
    ],
  },
  primaryType: 'MultiChainOps',
  message: {
    account: verifyingContract,
    ops: [
      { chainId: 42161n, nonce: 1n },
      { chainId: 10n, nonce: 2n },
    ],
  },
} as const satisfies TypedDataDefinition

function withMessage(message: unknown): TypedDataDefinition {
  return { ...multiChainOps, message } as unknown as TypedDataDefinition
}

function withDomainChainId(chainId: unknown): TypedDataDefinition {
  return {
    ...singleChainOps,
    domain: { ...singleChainOps.domain, chainId },
  } as unknown as TypedDataDefinition
}

describe('origin payload chain', () => {
  test('reads the domain chainId of a per-leg payload', () => {
    expect(originChainId(singleChainOps)).toBe(8453)
  })

  test('reads a domain chainId that arrives unnormalized', () => {
    // `normalizeIntentTypedData` widens uints to bigint, but a caller building
    // its own SignData hands over whatever the wire gave it.
    expect(originChainId(withDomainChainId('10'))).toBe(10)
    expect(originChainId(withDomainChainId(42161n))).toBe(42161)
  })

  test('reads the first ChainOps leaf when the domain names no chain', () => {
    expect(originChainId(multiChainOps)).toBe(42161)
  })

  test.each([
    ['not a number', 'abc'],
    ['an object', { id: 1 }],
    ['NaN itself', Number.NaN],
  ])('refuses a domain chainId that is %s', (_label, chainId) => {
    expect(() => originChainId(withDomainChainId(chainId))).toThrow(
      /unreadable domain chainId/u,
    )
  })

  test.each([
    ['no ops at all', { account: verifyingContract }],
    ['ops that are not an array', { ops: 'MultiChainOps' }],
    ['an empty ops array', { ops: [] }],
    ['a null leaf', { ops: [null] }],
    ['a leaf with no chainId', { ops: [{ nonce: 1n }] }],
    ['a leaf whose chainId is unreadable', { ops: [{ chainId: 'abc' }] }],
  ])('names the payload rather than yielding NaN for %s', (_label, message) => {
    expect(() => originChainId(withMessage(message))).toThrow(/names no chain/u)
  })

  test('names the payload when it carries no message', () => {
    expect(() => originChainId(withMessage(undefined))).toThrow(
      /names no chain/u,
    )
  })

  test('resolves the account chain from a multi-leg quote', () => {
    // A MultiChainOps quote carries ONE origin entry for a bundle of several
    // legs, so the account chain has to come out of the leaves too — reading
    // the domain here produced `Invalid chain id: NaN` and failed the intent
    // after the user had approved it.
    expect(accountChainIdFromOrigins([multiChainOps])).toBe(42161)
    expect(accountChainIdFromOrigins([singleChainOps])).toBe(8453)
  })

  test('takes the last origin of a per-leg quote', () => {
    expect(
      accountChainIdFromOrigins([singleChainOps, withDomainChainId(10)]),
    ).toBe(10)
  })

  test('recognises how many chains one signature has to reach', () => {
    expect(signatureSpansMultipleChains(multiChainOps)).toBe(true)
    expect(signatureSpansMultipleChains(singleChainOps)).toBe(false)
    expect(
      signatureSpansMultipleChains({
        ...multiChainOps,
        domain: undefined,
      } as unknown as TypedDataDefinition),
    ).toBe(true)
  })

  test('does not call same-chain legs multi-chain', () => {
    // `MultiChainOps` does not require its leaves to be on different chains:
    // same-chain legs with distinct nonces are a valid set, and are how a
    // bundle splits its destination ops across blocks. The domain is chainless
    // either way, so the domain alone cannot answer this — and a chain-bound
    // wrapper validates on every leg of a same-chain set.
    expect(
      signatureSpansMultipleChains(
        withMessage({
          account: verifyingContract,
          ops: [
            { chainId: 8453n, nonce: 1n },
            { chainId: 8453n, nonce: 2n },
          ],
        }),
      ),
    ).toBe(false)
    expect(
      signatureSpansMultipleChains(withMessage({ ops: [{ chainId: 1n }] })),
    ).toBe(false)
    // A payload naming no chain at all reaches nothing, and `originChainId`
    // refuses it separately — this must not report a span it cannot support.
    expect(signatureSpansMultipleChains(withMessage({ ops: [] }))).toBe(false)
    expect(signatureSpansMultipleChains(withMessage({ ops: 'nope' }))).toBe(
      false,
    )
    // An unreadable leaf drops out rather than counting as its own chain.
    expect(
      signatureSpansMultipleChains(
        withMessage({ ops: [{ chainId: 1n }, { chainId: null }] }),
      ),
    ).toBe(false)
  })

  test('rejects a quote with no origin payloads', () => {
    expect(() => accountChainIdFromOrigins([])).toThrow(
      'Intent quote has no origin payloads',
    )
  })
})
