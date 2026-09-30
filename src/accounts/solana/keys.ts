import { bytesToHex, type Hex, hexToBytes } from 'viem'

// source: SEC 2 v2 §2.4.1 — secp256k1 field prime p = 2^256 - 2^32 - 977, curve y² = x³ + 7.
const SECP256K1_P = 2n ** 256n - 2n ** 32n - 977n
const SECP256K1_B = 7n

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
  if (point && !onSecp256k1(point)) return undefined
  return compressSec1PublicKey(value as Hex)?.toLowerCase() as Hex | undefined
}

function uncompressedPoint(bytes: Uint8Array): Uint8Array | undefined {
  if (bytes.length === 64) return bytes
  if (bytes.length === 65 && bytes[0] === 4) return bytes.subarray(1)
  return undefined
}

function onSecp256k1(point: Uint8Array): boolean {
  const x = BigInt(bytesToHex(point.subarray(0, 32)))
  const y = BigInt(bytesToHex(point.subarray(32)))
  if (x >= SECP256K1_P || y >= SECP256K1_P) return false
  return (y * y - (x * x * x + SECP256K1_B)) % SECP256K1_P === 0n
}
