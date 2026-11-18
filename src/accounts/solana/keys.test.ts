import { p256 } from '@noble/curves/nist'
import { secp256k1 } from '@noble/curves/secp256k1'
import fc from 'fast-check'
import { bytesToHex, type Hex } from 'viem'
import { describe, expect, test } from 'vitest'
import { compressedCurvePoint } from './keys'

const curves = { secp256k1, secp256r1: p256 } as const

function nobleAccepts(curve: keyof typeof curves, key: Hex): boolean {
  try {
    curves[curve].ProjectivePoint.fromHex(key.slice(2)).assertValidity()
    return true
  } catch {
    return false
  }
}

describe('compressedCurvePoint', () => {
  test.each(['secp256k1', 'secp256r1'] as const)(
    'compresses a %s point given in any SEC1 form',
    (curve) => {
      const point = curves[curve].ProjectivePoint.BASE.multiply(7n)
      const compressed = bytesToHex(point.toRawBytes(true))
      const uncompressed = bytesToHex(point.toRawBytes(false))
      expect(compressedCurvePoint(curve, compressed)).toBe(compressed)
      expect(compressedCurvePoint(curve, uncompressed)).toBe(compressed)
      expect(
        compressedCurvePoint(curve, `0x${uncompressed.slice(4)}` as Hex),
      ).toBe(compressed)
      expect(compressedCurvePoint(curve, compressed.toUpperCase() as Hex)).toBe(
        undefined,
      )
      expect(
        compressedCurvePoint(curve, `0x${compressed.slice(2).toUpperCase()}`),
      ).toBe(compressed)
    },
  )

  test.each(['secp256k1', 'secp256r1'] as const)(
    'accepts exactly the compressed %s keys noble accepts',
    (curve) => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          fc.constantFrom('02', '03'),
          (x, prefix) => {
            const key = `0x${prefix}${bytesToHex(x).slice(2)}` as Hex
            const accepted = compressedCurvePoint(curve, key) !== undefined
            expect(accepted).toBe(nobleAccepts(curve, key))
          },
        ),
        { numRuns: 300 },
      )
    },
  )

  test('refuses an uncompressed point off its curve', () => {
    const point = p256.ProjectivePoint.BASE.toRawBytes(false)
    point[64] ^= 1
    expect(compressedCurvePoint('secp256r1', bytesToHex(point))).toBeUndefined()
    const k1 = secp256k1.ProjectivePoint.BASE.toRawBytes(false)
    expect(compressedCurvePoint('secp256r1', bytesToHex(k1))).toBeUndefined()
  })

  test('refuses a coordinate at or above the field prime', () => {
    const p = 2n ** 256n - 2n ** 32n - 977n
    expect(
      compressedCurvePoint('secp256k1', `0x02${p.toString(16)}`),
    ).toBeUndefined()
  })

  test('refuses other shapes', () => {
    for (const key of ['0x', '0x02', `0x04${'11'.repeat(32)}`, '0x1']) {
      expect(compressedCurvePoint('secp256k1', key as Hex)).toBeUndefined()
    }
    expect(
      compressedCurvePoint('secp256k1', `0x05${'11'.repeat(32)}`),
    ).toBeUndefined()
  })
})
