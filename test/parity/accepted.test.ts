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

  test('the splits liquidity error may gain a trace id', () => {
    expect(
      errors.map(({ scenario, path }) => ({ scenario, path })),
    ).toContainEqual({
      scenario: 'errors/reads',
      path: '/splits-insufficient-liquidity/hasTraceId',
    })
    expect(
      errors.map(({ scenario, path }) => ({ scenario, path })),
    ).toContainEqual({
      scenario: 'reads/splits',
      path: '/splits-settlement-layers/hasTraceId',
    })
  })
})
