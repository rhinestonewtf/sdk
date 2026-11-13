import type { TypedDataDefinition } from 'viem'
import { describe, expect, test } from 'vitest'
import recorded from '../orchestrator/__fixtures__/quote-responses.json'
import { type BlancRoute, quoteFromBlanc } from '../orchestrator/wire-quote'
import {
  payloadChainId,
  payloadChainIds,
  signatureSpansMultipleChains,
} from './payload-chain'

const multi = quoteFromBlanc(recorded.devMultiChainOpsRoute as BlancRoute)
  .signData.origin[0]
function payload(domain: unknown, message: unknown): TypedDataDefinition {
  return {
    primaryType: 'MultiChainOps',
    types: {},
    domain,
    message,
  } as TypedDataDefinition
}

describe('payload chain context', () => {
  test.each([84532, '84532', 84532n])(
    'domain chain %s wins over leaves',
    (chainId) => {
      const data = payload({ chainId }, multi.message)
      expect(payloadChainId(data)).toBe(84532)
      expect(payloadChainIds(data)).toEqual([84532])
      expect(signatureSpansMultipleChains(data)).toBe(false)
    },
  )

  test.each(['unreadable', Number.NaN, Infinity, {}, true])(
    'rejects unreadable domain %s',
    (chainId) => {
      const data = payload({ chainId }, multi.message)
      expect(() => payloadChainId(data)).toThrow(
        'Intent payload has an unreadable domain chainId:',
      )
      expect(() => payloadChainIds(data)).toThrow('unreadable domain chainId')
    },
  )

  test('uses signed leaf order for the recorded multi-leg route', () => {
    expect(payloadChainId(multi)).toBe(421614)
    expect(payloadChainIds(multi)).toEqual([421614, 84532])
    expect(signatureSpansMultipleChains(multi)).toBe(true)
  })

  test('deduplicates leaves in first-seen order, skipping unreadable leaves', () => {
    const data = payload(
      {},
      {
        ops: [
          null,
          {},
          { chainId: 'bad' },
          { chainId: 421614n },
          { chainId: '84532' },
          { chainId: 421614 },
        ],
      },
    )
    expect(payloadChainId(data)).toBe(421614)
    expect(payloadChainIds(data)).toEqual([421614, 84532])
  })

  test.each([undefined, {}, { chainId: null }])(
    'same-chain leaves are not spanning with domain %s',
    (domain) => {
      const data = payload(domain, {
        ops: [{ chainId: 84532n }, { chainId: '84532' }],
      })
      expect(payloadChainId(data)).toBe(84532)
      expect(payloadChainIds(data)).toEqual([84532])
      expect(signatureSpansMultipleChains(data)).toBe(false)
    },
  )

  test.each([
    undefined,
    {},
    { ops: {} },
    { ops: [] },
    { ops: [{}, null, { chainId: 'bad' }] },
  ])('rejects payload naming no chain: %s', (message) => {
    const data = payload({}, message)
    expect(() => payloadChainId(data)).toThrow(
      'Intent payload "MultiChainOps" names no chain:',
    )
    expect(() => payloadChainIds(data)).toThrow('names no chain')
    expect(signatureSpansMultipleChains(data)).toBe(false)
  })
})
