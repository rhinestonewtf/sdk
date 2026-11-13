import { normalizeBlancSponsorshipInput } from '../orchestrator/sponsorship-input'
import { jcsCanonicalise } from './jcs'

/**
 * Digest the legacy v1 callback input for a Blanc quote sponsorship approval.
 * Uses the same wire lowering as the client, then the sdk-2.16.2-blanc projection.
 * Accepts legacy input (including serialized bigints), not a Blanc wire request.
 */
export async function computeBlancIntentInputDigest(
  intentInput: unknown,
): Promise<string> {
  return computeIntentInputDigest(normalizeBlancSponsorshipInput(intentInput))
}

/**
 * Compute a deterministic hex-encoded SHA-256 digest of an intent input object.
 *
 * 1. JCS-canonicalise the intent input (RFC 8785)
 * 2. SHA-256 hash the UTF-8 bytes
 * 3. Return lowercase hex string
 *
 * Uses the Web Crypto API (available in Node.js ≥ 15 and all modern browsers).
 */
export async function computeIntentInputDigest(
  intentInput: unknown,
): Promise<string> {
  const canonical = jcsCanonicalise(intentInput)
  const encoded = new TextEncoder().encode(canonical)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
