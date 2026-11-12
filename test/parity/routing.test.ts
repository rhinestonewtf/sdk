import { describe, expect, test } from 'vitest'
import { routeRequest } from './routing'

describe('routeRequest', () => {
  test.each([
    ['POST', '/intents/route', 'quote'],
    ['POST', '/intent-operations', 'submit'],
    ['GET', '/intent-operation/123', 'status'],
    ['POST', '/intents/split', 'splits'],
  ] as const)('alps %s %s → %s', (method, path, op) => {
    expect(routeRequest(method, path, '2026-01.alps')).toEqual({
      apiVersion: 'alps',
      op,
      versionSource: 'path',
    })
  })

  test.each([
    ['POST', '/quotes', 'quote'],
    ['POST', '/intents', 'submit'],
    ['GET', '/intents/0xabc', 'status'],
    ['POST', '/intents/splits', 'splits'],
  ] as const)('blanc %s %s → %s', (method, path, op) => {
    expect(routeRequest(method, path, '2026-04.blanc')).toEqual({
      apiVersion: 'blanc',
      op,
      versionSource: 'path',
    })
  })

  test('alps submit without a version header is still alps', () => {
    expect(routeRequest('POST', '/intent-operations', undefined)).toEqual({
      apiVersion: 'alps',
      op: 'submit',
      versionSource: 'path',
    })
  })

  test('the path wins over a mismatched header', () => {
    expect(routeRequest('POST', '/quotes', '2026-01.alps').apiVersion).toBe(
      'blanc',
    )
  })

  test.each([
    ['GET', '/accounts/0xabc/portfolio', 'portfolio'],
    ['GET', '/app-fees/balances', 'appFeeBalances'],
    ['GET', '/chains', 'chains'],
  ] as const)('shared %s %s uses the header', (method, path, op) => {
    expect(routeRequest(method, path, '2026-04.blanc')).toEqual({
      apiVersion: 'blanc',
      op,
      versionSource: 'header',
    })
    expect(routeRequest(method, path, '2026-01.alps')).toEqual({
      apiVersion: 'alps',
      op,
      versionSource: 'header',
    })
    expect(routeRequest(method, path, undefined)).toEqual({
      apiVersion: 'alps',
      op,
      versionSource: 'unspecified',
    })
  })

  test('unknown endpoints are other', () => {
    expect(routeRequest('GET', '/health', undefined).op).toBe('other')
    expect(routeRequest('GET', '/intent-operations', undefined).op).toBe(
      'other',
    )
  })
})
