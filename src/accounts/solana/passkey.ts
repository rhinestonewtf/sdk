import type { Hex } from 'viem'
import { InvalidSolanaTransactionArtifactError } from '../../errors/execution'
import { compressSec1PublicKey } from './keys'

/**
 * SEC1-compresses a P-256 public key: the 64-byte x‖y a viem WebAuthn
 * credential carries, or a 65-byte `0x04`-prefixed key. A 33-byte compressed
 * key is returned unchanged. Only the shape is checked, not that the point lies
 * on the curve.
 */
export function compressP256PublicKey(publicKey: Hex): Hex {
  const compressed = compressSec1PublicKey(publicKey)
  if (!compressed) {
    throw new InvalidSolanaTransactionArtifactError(
      'the passkey public key must be a 64-byte x‖y, 65-byte uncompressed or 33-byte compressed P-256 key',
    )
  }
  return compressed
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
  return compressSec1PublicKey(value as Hex)?.toLowerCase() as Hex | undefined
}
