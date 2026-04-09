import { importJWK, SignJWT } from 'jose'
import { computeIntentInputDigest } from './digest'
import {
  shouldSponsor as checkSponsor,
  SponsorshipDeniedError,
  type SponsorshipFilter,
} from './sponsorship'

export interface JwtCredentials {
  privateKey: JsonWebKey
  integratorId: string
  projectId: string
  appId: string
  keyId: string
  audience?: string
}

export interface JwtSignerConfig {
  jwt: JwtCredentials
  shouldSponsor?: SponsorshipFilter
}

export function createJwtSigner(config: JwtSignerConfig): {
  accessToken: () => Promise<string>
  getIntentExtensionToken: (intentInput: unknown) => Promise<string>
} {
  const {
    jwt: {
      privateKey,
      integratorId,
      projectId,
      appId,
      keyId,
      audience = 'rhinestone-api',
    },
    shouldSponsor: filters,
  } = config

  let cachedKey: CryptoKey | null = null

  async function getKey(): Promise<CryptoKey> {
    if (!cachedKey) {
      cachedKey = (await importJWK(privateKey, 'RS256')) as CryptoKey
    }
    return cachedKey
  }

  async function accessToken(): Promise<string> {
    const key = await getKey()
    return new SignJWT({ typ: 'access', app_id: appId })
      .setProtectedHeader({ alg: 'RS256', kid: keyId })
      .setIssuer(integratorId)
      .setSubject(projectId)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key)
  }

  async function getIntentExtensionToken(
    intentInput: unknown,
  ): Promise<string> {
    if (filters) {
      const allowed = await checkSponsor(intentInput, filters)
      if (!allowed) {
        throw new SponsorshipDeniedError()
      }
    }

    const key = await getKey()
    const digest = await computeIntentInputDigest(intentInput)
    return new SignJWT({
      typ: 'intent_extension',
      app_id: appId,
      jti: crypto.randomUUID(),
      policy: {
        sponsorship: {
          scope: 'intent',
          intent_input: { digest },
        },
      },
    })
      .setProtectedHeader({ alg: 'RS256', kid: keyId })
      .setIssuer(integratorId)
      .setSubject(projectId)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key)
  }

  return { accessToken, getIntentExtensionToken }
}
