import { bytesToHex, type Hex, hexToBytes } from 'viem'

/** A short-Weierstrass curve y² = x³ + ax + b over the prime field of `p`. */
interface Curve {
  readonly p: bigint
  readonly a: bigint
  readonly b: bigint
}

const CURVES = {
  // source: SEC 2 v2 §2.4.1 — secp256k1, p = 2^256 - 2^32 - 977, y² = x³ + 7.
  secp256k1: { p: 2n ** 256n - 2n ** 32n - 977n, a: 0n, b: 7n },
  // source: SEC 2 v2 §2.4.2 — secp256r1 (P-256), a = -3.
  secp256r1: {
    p: 2n ** 256n - 2n ** 224n + 2n ** 192n + 2n ** 96n - 1n,
    a: -3n,
    b: 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn,
  },
} as const satisfies Record<string, Curve>

const HEX = /^0x(?:[0-9a-fA-F]{2})+$/u

/**
 * SEC1-compresses a public key on any short-Weierstrass curve with 32-byte
 * coordinates: a 64-byte x‖y or a 65-byte `0x04`-prefixed key gets the prefix
 * from y's parity, and a 33-byte compressed key passes through. `undefined` for
 * any other shape. The point is not checked to lie on a curve.
 */
export function compressSec1PublicKey(publicKey: Hex): Hex | undefined {
  const bytes = hexToBytes(publicKey)
  if (bytes.length === 33 && (bytes[0] === 2 || bytes[0] === 3)) {
    return publicKey
  }
  const point = uncompressedPoint(bytes)
  if (!point) return undefined
  const prefix = point[63]! % 2 === 0 ? 0x02 : 0x03
  return bytesToHex(new Uint8Array([prefix, ...point.subarray(0, 32)]))
}

/** Whether `value` is a 33-byte SEC1-compressed key in lowercase hex. */
export function isCompressedSec1PublicKey(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x0[23][0-9a-f]{64}$/u.test(value)
}

/** Whether `value` is hex of exactly 20 bytes: an EVM address, never a public key. */
export function isEvmAddressLength(value: unknown): boolean {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/u.test(value)
}

/**
 * The canonical form of a secp256k1 public key — compressed, lowercase hex —
 * from 33-byte compressed, 65-byte uncompressed or 64-byte x‖y hex. An
 * uncompressed key must lie on secp256k1, since compressing drops the y that
 * would reveal a key from another curve; a compressed key is shape-checked
 * only. `undefined` when `value` is not such a key.
 */
export function canonicalSecp256k1PublicKey(value: unknown): Hex | undefined {
  if (typeof value !== 'string' || !HEX.test(value)) return undefined
  const bytes = hexToBytes(value as Hex)
  const point = uncompressedPoint(bytes)
  if (point && !onCurve(CURVES.secp256k1, point)) return undefined
  return compressSec1PublicKey(value as Hex)?.toLowerCase() as Hex | undefined
}

/**
 * The compressed, lowercase form of a public key that is a point on `curve`,
 * from 33-byte compressed, 65-byte uncompressed or 64-byte x‖y hex. Unlike
 * `canonicalSecp256k1PublicKey`, a compressed key is checked too. `undefined`
 * for any other shape and for a point off the curve.
 */
export function compressedCurvePoint(
  curve: keyof typeof CURVES,
  value: Hex,
): Hex | undefined {
  if (!HEX.test(value)) return undefined
  const bytes = hexToBytes(value)
  const params = CURVES[curve]
  if (bytes.length === 33 && (bytes[0] === 2 || bytes[0] === 3)) {
    const x = BigInt(bytesToHex(bytes.subarray(1)))
    // Euler's criterion: some y solves the curve equation iff its right side is
    // a square. It is never 0: neither curve has a point of order 2.
    const isSquare =
      x < params.p &&
      modPow(curveSide(params, x), (params.p - 1n) / 2n, params.p) === 1n
    return isSquare ? (value.toLowerCase() as Hex) : undefined
  }
  const point = uncompressedPoint(bytes)
  if (!point || !onCurve(params, point)) return undefined
  return compressSec1PublicKey(value)?.toLowerCase() as Hex
}

function uncompressedPoint(bytes: Uint8Array): Uint8Array | undefined {
  if (bytes.length === 64) return bytes
  if (bytes.length === 65 && bytes[0] === 4) return bytes.subarray(1)
  return undefined
}

function onCurve(curve: Curve, point: Uint8Array): boolean {
  const x = BigInt(bytesToHex(point.subarray(0, 32)))
  const y = BigInt(bytesToHex(point.subarray(32)))
  if (x >= curve.p || y >= curve.p) return false
  return (y * y) % curve.p === curveSide(curve, x)
}

/** x³ + ax + b mod p. Both curves keep it positive for x ≥ 0, so no sign fix. */
function curveSide(curve: Curve, x: bigint): bigint {
  return (x * x * x + curve.a * x + curve.b) % curve.p
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n
  let factor = base % modulus
  for (let e = exponent; e > 0n; e >>= 1n) {
    if (e & 1n) result = (result * factor) % modulus
    factor = (factor * factor) % modulus
  }
  return result
}
