import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CanonicalLayers } from './canonical/types'
import { checkGolden, goldenFile, goldenView } from './golden'
import { stableStringify, toPlain } from './serialize'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'parity-golden-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

function layers(reads: unknown): CanonicalLayers {
  return {
    reads,
    traffic: [{ step: 'status', ops: ['status'] }],
  } as unknown as CanonicalLayers
}

describe('stableStringify', () => {
  test('sorts keys at every depth, tags bigints, ends with a newline', () => {
    expect(
      stableStringify({ b: 1n, a: { d: [{ z: 1, y: 2 }], c: undefined } }),
    ).toBe(
      '{\n  "a": {\n    "d": [\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": "1n"\n}\n',
    )
  })
})

describe('toPlain', () => {
  test('reduces chains and accounts to their identity', () => {
    expect(
      toPlain({
        chain: { id: 1, name: 'x', rpcUrls: {}, formatters: () => 0 },
        signer: { address: '0xAB', signMessage: () => 0 },
        bytes: new Uint8Array([1, 2]),
      }),
    ).toEqual({
      bytes: '0x0102',
      chain: { $chain: 1 },
      signer: { $account: '0xab' },
    })
  })
})

describe('goldens', () => {
  const tolerant = { $tolerance: { rule: 'r', value: '5', relative: 0.1 } }

  test('keep only golden layers, replace tolerance values, drop ignored paths', () => {
    const view = goldenView(
      layers({
        status: { result: { amount: tolerant } },
        splits: { op: 'splits', result: 1 },
      }),
      ['reads'],
      ['/reads/splits/result'],
    )
    expect(view).toEqual({
      reads: {
        splits: { op: 'splits' },
        status: { result: { amount: '<~r>' } },
      },
    })
  })

  test('write, match, then drift', () => {
    const view = goldenView(layers({ status: { result: 'COMPLETED' } }), [
      'reads',
      'traffic',
    ])
    expect(checkGolden('seed/x', view, { update: false, dir })).toEqual({
      status: 'missing',
    })
    expect(checkGolden('seed/x', view, { update: true, dir })).toMatchObject({
      status: 'updated',
    })
    expect(readFileSync(goldenFile('seed/x', dir), 'utf8')).toBe(
      stableStringify(view),
    )
    expect(checkGolden('seed/x', view, { update: false, dir })).toEqual({
      status: 'match',
    })

    const drifted = goldenView(layers({ status: { result: 'FAILED' } }), [
      'reads',
      'traffic',
    ])
    expect(checkGolden('seed/x', drifted, { update: false, dir })).toEqual({
      status: 'drift',
      diffs: [
        {
          layer: 'reads',
          path: '/status/result',
          kind: 'changed',
          a: 'COMPLETED',
          b: 'FAILED',
        },
      ],
    })
  })
})
