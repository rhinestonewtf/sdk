import { describe, expect, test } from 'vitest'
import { ACCEPTED } from './accepted'

describe('accepted differences', () => {
  const errors = ACCEPTED.filter((entry) => entry.layer === 'errors')

  test('errors entries are scoped to one scenario and one exact path', () => {
    for (const entry of errors) {
      expect(entry.scenario, entry.path).toBeTruthy()
      expect(entry.scenario).not.toContain('*')
      expect(entry.path).not.toContain('*')
      expect(entry.reason.trim()).not.toBe('')
    }
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
