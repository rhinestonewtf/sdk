import { describe, expect, test } from 'vitest'
import {
  ACCEPTED,
  type AcceptedDifference,
  assertExactErrorEntries,
  SCENARIO_ACCEPTED,
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
      // Blanc words an unknown quote token and chain differently.
      {
        scenario: 'errors/quote-rejections',
        path: '/unsupported-token/message',
      },
      {
        scenario: 'errors/quote-rejections',
        path: '/unsupported-chain/context/path',
      },
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

  test('quote requests differ only by the two options v1 no longer sends', () => {
    expect(
      ACCEPTED.filter((entry) => entry.layer === 'quoteRequest').map(
        ({ scenario, path }) => ({ scenario, path }),
      ),
    ).toEqual([
      { scenario: undefined, path: '/*/options/topupCompact' },
      {
        scenario: 'mapping/cross-chain-options',
        path: '/fee-asset/options/feeToken',
      },
    ])
  })

  test('scenario-local entries are exact paths with a reason', () => {
    expect(
      Object.fromEntries(
        Object.entries(SCENARIO_ACCEPTED).map(([id, entries]) => [
          id,
          entries.length,
        ]),
      ),
    ).toEqual({
      'funded/session-verify-executions': 3,
      'funded/cctp-safe': 21,
    })
    for (const entry of Object.values(SCENARIO_ACCEPTED).flat()) {
      expect(entry.path).not.toMatch(/[*(|)]/)
      expect(entry.scenario).toBeUndefined()
      expect(entry.reason.trim()).not.toBe('')
    }
  })
})
