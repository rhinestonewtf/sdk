import { describe, expect, test } from 'vitest'
import {
  ACCEPTED,
  type AcceptedDifference,
  assertExactErrorEntries,
} from './accepted'

describe('accepted differences', () => {
  const errors = ACCEPTED.filter((entry) => entry.layer === 'errors')

  test('errors entries are scoped to one scenario and one exact path', () => {
    for (const entry of errors) {
      expect(entry.scenario, entry.path).toBeTruthy()
      expect(entry.reason.trim()).not.toBe('')
    }
    expect(() => assertExactErrorEntries(ACCEPTED)).not.toThrow()
  })

  test.each([
    ['a wildcard', '/step/*'],
    ['a recursive wildcard', '/**/message'],
    ['an alternation', '/step/(message|context)'],
    ['a bare alternation', '/step/message|context'],
  ])('the errors layer rejects %s in a path or scenario', (_, path) => {
    const entry: AcceptedDifference = {
      layer: 'errors',
      scenario: 'errors/reads',
      path,
      reason: 'x',
    }
    expect(() => assertExactErrorEntries([entry])).toThrow()
    expect(() =>
      assertExactErrorEntries([
        { ...entry, path: '/step/message', scenario: path },
      ]),
    ).toThrow()
    expect(() =>
      assertExactErrorEntries([{ ...entry, layer: 'traffic' }]),
    ).not.toThrow()
  })

  test('the expected entries exist, and no others', () => {
    expect(errors.map(({ scenario, path }) => ({ scenario, path }))).toEqual([
      // The splits liquidity error may gain a trace id.
      {
        scenario: 'errors/reads',
        path: '/splits-insufficient-liquidity/hasTraceId',
      },
      {
        scenario: 'reads/splits',
        path: '/splits-settlement-layers/hasTraceId',
      },
      // Blanc words an unknown chain id differently.
      { scenario: 'errors/reads', path: '/splits-unsupported-chain/message' },
      { scenario: 'reads/client', path: '/portfolio-unknown-chain/message' },
    ])
  })
})
