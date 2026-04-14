/**
 * Generate an RS256 keypair for Rhinestone JWT authentication.
 *
 * Usage:
 *   bun run scripts/generate-jwt-keypair.ts
 *   bun run scripts/generate-jwt-keypair.ts --kid my-key-id
 *
 * Outputs:
 *   - Private key JWK (for your backend / signer)
 *   - Public key JWK  (for seeding into the Rhinestone database)
 */

import { exportJWK, generateKeyPair } from 'jose'

const kidArg = process.argv.find((a) => a.startsWith('--kid='))
const kidIdx = process.argv.indexOf('--kid')
const kid =
  kidArg?.split('=')[1] ??
  (kidIdx !== -1 ? process.argv[kidIdx + 1] : undefined) ??
  `key_${Date.now()}`

const { publicKey, privateKey } = await generateKeyPair('RS256', {
  extractable: true,
})

const privateJwk = await exportJWK(privateKey)
privateJwk.kid = kid
privateJwk.use = 'sig'
privateJwk.alg = 'RS256'

const publicJwk = await exportJWK(publicKey)
publicJwk.kid = kid
publicJwk.use = 'sig'
publicJwk.alg = 'RS256'

console.info('=== PRIVATE KEY (keep secret — for your backend) ===')
console.info(JSON.stringify(privateJwk, null, 2))
console.info()
console.info('=== PUBLIC KEY (seed into Rhinestone DB) ===')
console.info(JSON.stringify(publicJwk, null, 2))
