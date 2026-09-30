import { bytesToHex, type Hex, hexToBytes } from 'viem'
import { InvalidSolanaTransactionArtifactError } from '../../errors/execution'

/**
 * SEC1-compresses a P-256 public key: the 64-byte x‖y a viem WebAuthn
 * credential carries, or a 65-byte `0x04`-prefixed key. A 33-byte compressed
 * key is returned unchanged. Only the shape is checked, not that the point lies
 * on the curve.
 */
export function compressP256PublicKey(publicKey: Hex): Hex {
  const bytes = hexToBytes(publicKey)
  if (bytes.length === 33 && (bytes[0] === 2 || bytes[0] === 3)) {
    return publicKey
  }
  const point =
    bytes.length === 64
      ? bytes
      : bytes.length === 65 && bytes[0] === 4
        ? bytes.subarray(1)
        : undefined
  if (!point) {
    throw new InvalidSolanaTransactionArtifactError(
      'the passkey public key must be a 64-byte x‖y, 65-byte uncompressed or 33-byte compressed P-256 key',
    )
  }
  const prefix = point[63]! % 2 === 0 ? 0x02 : 0x03
  return bytesToHex(new Uint8Array([prefix, ...point.subarray(0, 32)]))
}

/** Whether `value` is a 33-byte SEC1-compressed key in lowercase hex. */
export function isCompressedP256PublicKey(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x0[23][0-9a-f]{64}$/u.test(value)
}

/**
 * The canonical form of a P-256 public key in any encoding
 * {@link compressP256PublicKey} accepts: compressed, lowercase hex. `undefined`
 * when `value` is not such a key, so each caller refuses with its own error.
 */
export function canonicalP256PublicKey(value: unknown): Hex | undefined {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(value)) {
    return undefined
  }
  try {
    return compressP256PublicKey(value as Hex).toLowerCase() as Hex
  } catch {
    return undefined
  }
}
