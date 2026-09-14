import { describe, expect, test } from 'vitest'
import { solanaAddress } from './non-evm'

describe('solanaAddress', () => {
  test('accepts canonical 32-byte base58 addresses including leading zeroes', () => {
    const value = '11111111111111111111111111111111'
    expect(solanaAddress(value)).toBe(value)
    expect(solanaAddress('Vote111111111111111111111111111111111111111')).toBe(
      'Vote111111111111111111111111111111111111111',
    )
  })

  test.each([
    '',
    '1111111111111111111111111111111',
    '111111111111111111111111111111111',
    '0x0000000000000000000000000000000000000000',
    'O0Il',
  ])('rejects malformed address %s', (value) => {
    expect(() => solanaAddress(value)).toThrow(TypeError)
  })
})
