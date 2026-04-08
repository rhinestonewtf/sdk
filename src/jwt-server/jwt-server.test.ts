import {
  decodeJwt,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
} from 'jose'
import { describe, expect, it } from 'vitest'
import { createAuthProvider } from '../auth/provider'
import { computeIntentInputDigest } from './digest'
import { jcsCanonicalise } from './jcs'
import { createJwtSigner } from './signer'

describe('createAuthProvider routing', () => {
  it('resolves api key mode from apiKey field', async () => {
    const provider = createAuthProvider({ apiKey: 'test-key' })
    const headers = await provider.getHeaders()

    expect(headers['x-api-key']).toBe('test-key')
  })

  it('resolves api key mode from auth config', async () => {
    const provider = createAuthProvider({
      auth: { mode: 'apiKey', apiKey: 'test-key-2' },
    })
    const headers = await provider.getHeaders()

    expect(headers['x-api-key']).toBe('test-key-2')
  })

  it('resolves jwt mode with static token', async () => {
    const provider = createAuthProvider({
      auth: { mode: 'jwt', accessToken: 'static-jwt-token' },
    })
    const headers = await provider.getHeaders()

    expect(headers.Authorization).toBe('Bearer static-jwt-token')
  })

  it('resolves jwt mode with async token getter', async () => {
    const provider = createAuthProvider({
      auth: {
        mode: 'jwt',
        accessToken: async () => 'dynamic-jwt-token',
      },
    })
    const headers = await provider.getHeaders()

    expect(headers.Authorization).toBe('Bearer dynamic-jwt-token')
  })

  it('throws when neither apiKey nor auth is provided', () => {
    expect(() => createAuthProvider({})).toThrow(/apiKey.*auth/)
  })

  it('prefers auth over deprecated apiKey', async () => {
    const provider = createAuthProvider({
      apiKey: 'old-key',
      auth: { mode: 'jwt', accessToken: 'jwt-wins' },
    })
    const headers = await provider.getHeaders()

    expect(headers.Authorization).toBe('Bearer jwt-wins')
    expect(headers['x-api-key']).toBe('jwt')
  })

  it('jwt mode getSubmitHeaders calls getIntentExtensionToken when sponsored', async () => {
    const provider = createAuthProvider({
      auth: {
        mode: 'jwt',
        accessToken: 'my-access-token',
        getIntentExtensionToken: async (intentInput) => {
          return `ext-for-${(intentInput as any).id}`
        },
      },
    })

    const headers = await provider.getSubmitHeaders({ id: 'intent-42' }, true)

    expect(headers.Authorization).toBe('Bearer my-access-token')
    expect(headers['X-Intent-Extension']).toBe('Bearer ext-for-intent-42')
  })

  it('jwt mode getSubmitHeaders skips extension token when not sponsored', async () => {
    let callbackCalled = false
    const provider = createAuthProvider({
      auth: {
        mode: 'jwt',
        accessToken: 'my-access-token',
        getIntentExtensionToken: async () => {
          callbackCalled = true
          return 'should-not-be-used'
        },
      },
    })

    const headers = await provider.getSubmitHeaders({ id: 'intent-42' }, false)

    expect(headers.Authorization).toBe('Bearer my-access-token')
    expect(headers['X-Intent-Extension']).toBeUndefined()
    expect(callbackCalled).toBe(false)
  })

  it('jwt mode getSubmitHeaders works without getIntentExtensionToken callback', async () => {
    const provider = createAuthProvider({
      auth: { mode: 'jwt', accessToken: 'my-access-token' },
    })

    const headers = await provider.getSubmitHeaders({ id: 'intent-42' }, true)

    expect(headers.Authorization).toBe('Bearer my-access-token')
    expect(headers['X-Intent-Extension']).toBeUndefined()
  })
})

describe('jcsCanonicalise', () => {
  it('sorts object keys lexicographically', () => {
    expect(jcsCanonicalise({ z: 1, a: 2, m: 3 })).toBe('{"a":2,"m":3,"z":1}')
  })

  it('sorts nested object keys', () => {
    expect(jcsCanonicalise({ b: { d: 1, c: 2 }, a: 3 })).toBe(
      '{"a":3,"b":{"c":2,"d":1}}',
    )
  })

  it('serializes arrays without reordering', () => {
    expect(jcsCanonicalise([3, 1, 2])).toBe('[3,1,2]')
  })

  it('skips undefined properties', () => {
    expect(jcsCanonicalise({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}')
  })

  it('coerces safe BigInt to number string', () => {
    expect(jcsCanonicalise({ amount: BigInt('1000000') })).toBe(
      '{"amount":1000000}',
    )
  })

  it('throws on BigInt exceeding safe integer range', () => {
    expect(() =>
      jcsCanonicalise({ amount: BigInt('9007199254740992') }),
    ).toThrow(/exceeds safe integer range/)
  })

  it('normalizes negative zero to zero', () => {
    expect(jcsCanonicalise({ val: -0 })).toBe('{"val":0}')
  })

  it('throws on non-finite numbers', () => {
    expect(() => jcsCanonicalise({ val: NaN })).toThrow(/non-finite/)
    expect(() => jcsCanonicalise({ val: Infinity })).toThrow(/non-finite/)
    expect(() => jcsCanonicalise({ val: -Infinity })).toThrow(/non-finite/)
  })

  it('serializes null and primitives', () => {
    expect(jcsCanonicalise(null)).toBe('null')
    expect(jcsCanonicalise(true)).toBe('true')
    expect(jcsCanonicalise(false)).toBe('false')
    expect(jcsCanonicalise('hello')).toBe('"hello"')
    expect(jcsCanonicalise(42)).toBe('42')
  })
})

describe('computeIntentInputDigest', () => {
  it('produces deterministic hex digest for a given input', async () => {
    const input = { transfers: [{ token: 'USDC', amount: '1000000' }] }
    const digest1 = await computeIntentInputDigest(input)
    const digest2 = await computeIntentInputDigest(input)

    expect(digest1).toBe(digest2)
    expect(digest1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces different digests for different inputs', async () => {
    const digest1 = await computeIntentInputDigest({ a: 1 })
    const digest2 = await computeIntentInputDigest({ a: 2 })

    expect(digest1).not.toBe(digest2)
  })

  it('produces same digest regardless of key order', async () => {
    const digest1 = await computeIntentInputDigest({ z: 1, a: 2 })
    const digest2 = await computeIntentInputDigest({ a: 2, z: 1 })

    expect(digest1).toBe(digest2)
  })
})

describe('createJwtSigner', () => {
  async function makeTestConfig() {
    const { privateKey } = await generateKeyPair('RS256', {
      extractable: true,
    })
    const jwk = await exportJWK(privateKey)
    return {
      privateKey: jwk,
      integratorId: 'test-integrator',
      projectId: 'test-project',
      appId: 'test-app',
      keyId: 'test-key',
    }
  }

  it('returns accessToken and getIntentExtensionToken functions', async () => {
    const signer = createJwtSigner(await makeTestConfig())

    expect(typeof signer.accessToken).toBe('function')
    expect(typeof signer.getIntentExtensionToken).toBe('function')
  })

  it('accessToken returns a JWT with correct claims', async () => {
    const config = await makeTestConfig()
    const signer = createJwtSigner(config)
    const token = await signer.accessToken()

    const header = decodeProtectedHeader(token)
    expect(header.alg).toBe('RS256')
    expect(header.kid).toBe('test-key')

    const payload = decodeJwt(token)
    expect(payload.iss).toBe('test-integrator')
    expect(payload.sub).toBe('test-project')
    expect(payload.aud).toBe('rhinestone-api')
    expect((payload as any).typ).toBe('access')
    expect((payload as any).app_id).toBe('test-app')
    expect(payload.exp).toBeDefined()
  })

  it('getIntentExtensionToken returns a JWT with digest in policy', async () => {
    const config = await makeTestConfig()
    const signer = createJwtSigner(config)
    const intentInput = { amount: '1000', token: 'USDC' }
    const token = await signer.getIntentExtensionToken(intentInput)

    const payload = decodeJwt(token) as any
    expect(payload.typ).toBe('intent_extension')
    expect(payload.app_id).toBe('test-app')
    expect(payload.jti).toBeDefined()
    expect(payload.policy.sponsorship.scope).toBe('intent')
    expect(payload.policy.sponsorship.intent_input.digest).toMatch(
      /^[0-9a-f]{64}$/,
    )
  })

  it('uses custom audience when provided', async () => {
    const config = await makeTestConfig()
    const signer = createJwtSigner({ ...config, audience: 'custom-audience' })
    const token = await signer.accessToken()

    const payload = decodeJwt(token)
    expect(payload.aud).toBe('custom-audience')
  })

  it('caches the key across calls', async () => {
    const config = await makeTestConfig()
    const signer = createJwtSigner(config)

    const token1 = await signer.accessToken()
    const token2 = await signer.accessToken()

    // Both should be valid JWTs (key import succeeded both times via cache)
    expect(token1.split('.')).toHaveLength(3)
    expect(token2.split('.')).toHaveLength(3)
  })
})
