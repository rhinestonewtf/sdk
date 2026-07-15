import { describe, expect, it } from 'vitest'
import {
  serializeArtifact,
  stableStringify,
  toStableValue,
} from './serialization'

describe('characterization serialization', () => {
  it('sorts object and map keys while preserving array order', () => {
    const first = {
      z: 1,
      values: ['third', 'first', 'second'],
      lookup: new Map<unknown, unknown>([
        ['z', 1n],
        ['a', undefined],
      ]),
      a: 2,
    }
    const second = {
      a: 2,
      lookup: new Map<unknown, unknown>([
        ['a', undefined],
        ['z', 1n],
      ]),
      values: ['third', 'first', 'second'],
      z: 1,
    }

    expect(stableStringify(first)).toBe(stableStringify(second))
    expect(toStableValue(first)).toMatchObject({
      lookup: {
        $characterizationType: 'map',
        value: [
          {
            key: 'a',
            value: { $characterizationType: 'undefined' },
          },
          {
            key: 'z',
            value: { $characterizationType: 'bigint', value: '1' },
          },
        ],
      },
      values: ['third', 'first', 'second'],
    })
  })

  it('represents bigint, Date, undefined, negative zero, and Hex deliberately', () => {
    expect(
      toStableValue({
        amount: 9_007_199_254_740_993n,
        at: new Date('2025-01-02T03:04:05.000Z'),
        missing: undefined,
        negativeZero: -0,
        signature: '0x1234',
      }),
    ).toEqual({
      amount: {
        $characterizationType: 'bigint',
        value: '9007199254740993',
      },
      at: {
        $characterizationType: 'date',
        value: '2025-01-02T03:04:05.000Z',
      },
      missing: { $characterizationType: 'undefined' },
      negativeZero: { $characterizationType: 'number', value: '-0' },
      signature: '0x1234',
    })
  })

  it('rejects values without an intentional artifact representation', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    expect(() => stableStringify({ value: Number.NaN })).toThrow(
      'Cannot serialize non-finite number at /value',
    )
    expect(() => stableStringify({ callback: () => undefined })).toThrow(
      'Cannot serialize function at /callback',
    )
    expect(() => stableStringify(cyclic)).toThrow(
      'Cannot serialize cyclic value at /self',
    )
  })

  it('secret-scans before serializing an artifact', () => {
    const secret = 'Bearer this-must-not-appear-in-the-error'

    expect(() =>
      serializeArtifact({ headers: { Authorization: secret } }),
    ).toThrowError(/auth-header at \/headers\/Authorization/)
    try {
      serializeArtifact({ headers: { Authorization: secret } })
    } catch (error) {
      expect(String(error)).not.toContain(secret)
    }
  })
})
