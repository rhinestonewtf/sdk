import type { Hex } from 'viem'
import { describe, expect, test } from 'vitest'
import { compareHexValues } from './ordering'

describe('Hex Ordering', () => {
  test('orders by value, not by host collation', () => {
    expect(compareHexValues('0xaa7d', '0xb1a4')).toEqual(-1)
    expect(compareHexValues('0xb1a4', '0xaa7d')).toEqual(1)
    expect(compareHexValues('0xdd', '0xde')).toEqual(-1)
    expect(compareHexValues('0xff', '0x0100')).toEqual(-1)
  })

  test('treats equal values as equal regardless of casing', () => {
    expect(compareHexValues('0xaa7d', '0xaa7d')).toEqual(0)
    expect(compareHexValues('0xAA7D', '0xaa7d')).toEqual(0)
    expect(compareHexValues('0xAA7D', '0xb1a4')).toEqual(-1)
  })

  test('sorts a list ascending', () => {
    const values: Hex[] = ['0xb1a4', '0xaa7d', '0x01']
    expect(values.sort(compareHexValues)).toEqual(['0x01', '0xaa7d', '0xb1a4'])
  })
})
