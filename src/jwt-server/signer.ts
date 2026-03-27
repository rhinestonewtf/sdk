import { computeIntentInputDigest } from './digest'

export interface JwtSignerConfig {
  /** RS256 private key — CryptoKey, JWK object, or PEM string. */
  privateKey: CryptoKey | JsonWebKey | string
  /** Integrator identifier (JWT `iss` claim). */
  integratorId: string
  /** Project identifier (JWT `sub` claim). */
  projectId: string
  /** App / environment identifier (JWT `app_id` claim). */
  appId: string
  /** Key identifier included in the JWT header (`kid`). */
  keyId: string
  /** JWT audience. Defaults to `'rhinestone-api'`. */
  audience?: string
}

export interface JwtSigner {
  /** Sign an access token (identity JWT). */
  signAccessToken(opts?: { expiresIn?: string }): Promise<string>
  /** Sign an intent extension token bound to a specific intent input. */
  signIntentExtensionToken(intentInput: unknown): Promise<string>
}

/**
 * Create a JWT signer for Rhinestone authentication.
 *
 * Requires the `jose` package (optional peer dependency of `@rhinestone/sdk`).
 * Only intended for **server-side / backend** use.
 *
 * ```ts
 * import { createJwtSigner } from '@rhinestone/sdk/server'
 *
 * const signer = createJwtSigner({
 *   privateKey: myRS256PrivateKey,
 *   integratorId: 'int_abc',
 *   projectId: 'proj_xyz',
 *   appId: 'app_prod',
 *   keyId: 'key_1',
 * })
 *
 * const accessToken = await signer.signAccessToken()
 * const extensionToken = await signer.signIntentExtensionToken(intentInput)
 * ```
 */
export function createJwtSigner(config: JwtSignerConfig): JwtSigner {
  const audience = config.audience ?? 'rhinestone-api'

  return {
    signAccessToken: (opts) => signAccess(config, audience, opts),
    signIntentExtensionToken: (intentInput) =>
      signIntentExtension(config, audience, intentInput),
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Dynamically import jose — throws a helpful error if not installed. */
async function loadJose(): Promise<typeof import('jose')> {
  try {
    return await import('jose')
  } catch {
    throw new Error(
      '@rhinestone/sdk/server requires the "jose" package. Install it with: npm install jose',
    )
  }
}

/** Resolve the private key into a format jose accepts. */
async function resolveKey(
  jose: typeof import('jose'),
  raw: CryptoKey | JsonWebKey | string,
): Promise<CryptoKey> {
  if (raw instanceof CryptoKey) {
    return raw
  }
  if (typeof raw === 'string') {
    // PEM-encoded key
    return (await jose.importPKCS8(raw, 'RS256')) as CryptoKey
  }
  // JWK object
  return (await jose.importJWK(raw as import('jose').JWK, 'RS256')) as CryptoKey
}

function parseExpiresIn(expiresIn: string | undefined): string {
  return expiresIn ?? '1h'
}

async function signAccess(
  config: JwtSignerConfig,
  audience: string,
  opts?: { expiresIn?: string },
): Promise<string> {
  const jose = await loadJose()
  const key = await resolveKey(jose, config.privateKey)

  return new jose.SignJWT({
    typ: 'access',
    app_id: config.appId,
  })
    .setProtectedHeader({ alg: 'RS256', kid: config.keyId })
    .setIssuer(config.integratorId)
    .setAudience(audience)
    .setSubject(config.projectId)
    .setIssuedAt()
    .setExpirationTime(parseExpiresIn(opts?.expiresIn))
    .sign(key)
}

async function signIntentExtension(
  config: JwtSignerConfig,
  audience: string,
  intentInput: unknown,
): Promise<string> {
  const jose = await loadJose()
  const key = await resolveKey(jose, config.privateKey)
  const digest = await computeIntentInputDigest(intentInput)

  return new jose.SignJWT({
    typ: 'intent_extension',
    app_id: config.appId,
    policy: {
      sponsorship: {
        scope: 'intent',
        intent_input: {
          digest,
        },
      },
    },
  })
    .setProtectedHeader({ alg: 'RS256', kid: config.keyId })
    .setIssuer(config.integratorId)
    .setAudience(audience)
    .setSubject(config.projectId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .setJti(crypto.randomUUID())
    .sign(key)
}
