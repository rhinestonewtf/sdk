import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { normalizeModules } from './normalize'
import type { ConfiguredModule } from './types'

const module = (address: `0x${string}`): ConfiguredModule => ({
  kind: 'validator',
  address,
  initData: { source: 'omitted' },
  deInitData: { source: 'omitted' },
  additionalContext: { source: 'omitted' },
})

describe('module normalization', () => {
  test('preserves order and duplicate multiplicity', () => {
    const first = module('0x0000000000000000000000000000000000000001')
    const second = module('0x0000000000000000000000000000000000000002')
    expect(
      normalizeModules([first, second, first]).map((item) => item.address),
    ).toEqual([first.address, second.address, first.address])
  })

  test('materializes omitted bytes without mutating input', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constant(module('0x0000000000000000000000000000000000000001')),
        ),
        (input) => {
          const snapshot = structuredClone(input)
          const output = normalizeModules(input)
          expect(input).toEqual(snapshot)
          expect(output.every((item) => item.initData === '0x')).toBe(true)
        },
      ),
    )
  })

  test('preserves explicit lifecycle data', () => {
    expect(
      normalizeModules([
        {
          ...module('0x0000000000000000000000000000000000000001'),
          initData: { source: 'explicit', value: '0x01' },
          deInitData: { source: 'explicit', value: '0x02' },
          additionalContext: { source: 'explicit', value: '0x03' },
        },
      ])[0],
    ).toMatchObject({
      initData: '0x01',
      deInitData: '0x02',
      additionalContext: '0x03',
    })
  })
})
