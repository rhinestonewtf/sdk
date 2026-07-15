import { describe, expect, it } from 'vitest'
import { compareObservations } from './compare'
import { normalizeObservation } from './normalize'

describe('characterization comparison', () => {
  it('compares structured values independently of object and map insertion order', () => {
    const expected = {
      b: new Map([
        ['two', 2n],
        ['one', 1n],
      ]),
      a: undefined,
    }
    const actual = {
      a: undefined,
      b: new Map([
        ['one', 1n],
        ['two', 2n],
      ]),
    }

    expect(compareObservations(expected, actual)).toEqual({
      equal: true,
      deltas: [],
      truncated: false,
    })
  })

  it('reports useful paths for type, value, missing, extra, and ordered-array deltas', () => {
    const result = compareObservations(
      {
        operations: [
          { chainId: 1, state: 'complete' },
          { chainId: 10, state: 'complete' },
        ],
        optional: true,
      },
      {
        operations: [{ chainId: '1', state: 'failed', unexpected: true }],
      },
    )

    expect(result.equal).toBe(false)
    expect(result.deltas).toEqual([
      {
        path: '/operations',
        kind: 'array-length',
        expected: 2,
        actual: 1,
      },
      {
        path: '/operations/0/chainId',
        kind: 'type',
        expected: 1,
        actual: '1',
      },
      {
        path: '/operations/0/state',
        kind: 'value',
        expected: 'complete',
        actual: 'failed',
      },
      {
        path: '/operations/0/unexpected',
        kind: 'unexpected-actual',
        actual: true,
      },
      {
        path: '/operations/1',
        kind: 'missing-actual',
        expected: { chainId: 10, state: 'complete' },
      },
      {
        path: '/optional',
        kind: 'missing-actual',
        expected: true,
      },
    ])
  })

  it('compares normalized identity subjects semantically', () => {
    const mapping = {
      path: '/accountAddress',
      identity: 'subject-account',
      values: ['0xlegacy', '0xrewrite'],
      reason: 'execute runs use independent state',
    }
    const legacy = normalizeObservation(
      { accountAddress: '0xlegacy', terminalState: 'complete' },
      { identityMappings: [mapping] },
    ).value
    const rewrite = normalizeObservation(
      { accountAddress: '0xrewrite', terminalState: 'complete' },
      { identityMappings: [mapping] },
    ).value

    expect(compareObservations(legacy, rewrite).equal).toBe(true)
  })

  it('bounds diagnostic output and rejects unsafe comparisons', () => {
    const bounded = compareObservations(
      { a: 1, b: 2, c: 3 },
      { a: 4, b: 5, c: 6 },
      { maxDeltas: 2 },
    )

    expect(bounded).toMatchObject({
      equal: false,
      truncated: true,
      deltas: [
        { path: '/a', kind: 'value' },
        { path: '/b', kind: 'value' },
      ],
    })
    expect(
      compareObservations(
        { a: 1, b: 2, c: 3 },
        { a: 4, b: 5, c: 3 },
        { maxDeltas: 2 },
      ).truncated,
    ).toBe(false)
    expect(() =>
      compareObservations(
        { status: 'ok' },
        { headers: { authorization: 'Bearer do-not-write' } },
      ),
    ).toThrow(/auth-header at \/headers\/authorization/)
  })
})
