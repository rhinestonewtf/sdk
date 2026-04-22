import {
  decodeJwt,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
} from 'jose'
import { describe, expect, it } from 'vitest'
import { createAuthProvider } from '../auth/provider'
import { computeIntentInputDigest } from './digest'
import { jcsCanonicalise } from './jcs'
import { createJwtSigner } from './signer'
import { SponsorshipDeniedError, shouldSponsor } from './sponsorship'

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
      auth: { mode: 'experimental_jwt', accessToken: 'static-jwt-token' },
    })
    const headers = await provider.getHeaders()

    expect(headers.Authorization).toBe('Bearer static-jwt-token')
  })

  it('resolves jwt mode with async token getter', async () => {
    const provider = createAuthProvider({
      auth: {
        mode: 'experimental_jwt',
        accessToken: async () => 'dynamic-jwt-token',
      },
    })
    const headers = await provider.getHeaders()

    expect(headers.Authorization).toBe('Bearer dynamic-jwt-token')
  })

  it('jwt mode getSubmitHeaders calls getIntentExtensionToken when sponsored', async () => {
    const provider = createAuthProvider({
      auth: {
        mode: 'experimental_jwt',
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
        mode: 'experimental_jwt',
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
      auth: { mode: 'experimental_jwt', accessToken: 'my-access-token' },
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

describe('shouldSponsor', () => {
  const validIntentInput = {
    account: { address: '0x1234000000000000000000000000000000000000' },
    destinationChainId: 8453,
    destinationExecutions: [
      {
        to: '0xaaaa000000000000000000000000000000000000',
        value: '1000000',
        data: '0x',
      },
    ],
    tokenRequests: [],
    options: {},
  }

  it('returns true when no filters are provided', async () => {
    expect(await shouldSponsor(validIntentInput, {})).toBe(true)
  })

  it('passes chain id to chain filter', async () => {
    const result = await shouldSponsor(validIntentInput, {
      chain: (chain) => chain.id === 8453,
    })
    expect(result).toBe(true)

    const rejected = await shouldSponsor(validIntentInput, {
      chain: (chain) => chain.id === 1,
    })
    expect(rejected).toBe(false)
  })

  it('passes account address to account filter', async () => {
    const result = await shouldSponsor(validIntentInput, {
      account: (addr) => addr === '0x1234000000000000000000000000000000000000',
    })
    expect(result).toBe(true)

    const rejected = await shouldSponsor(validIntentInput, {
      account: (addr) => addr === '0xdead000000000000000000000000000000000000',
    })
    expect(rejected).toBe(false)
  })

  it('passes calls with bigint values to calls filter', async () => {
    const result = await shouldSponsor(validIntentInput, {
      calls: (calls) => {
        expect(calls).toHaveLength(1)
        expect(calls[0].to).toBe('0xaaaa000000000000000000000000000000000000')
        expect(calls[0].value).toBe(1000000n)
        expect(calls[0].data).toBe('0x')
        return true
      },
    })
    expect(result).toBe(true)
  })

  it('AND-composes all filters (all pass)', async () => {
    const result = await shouldSponsor(validIntentInput, {
      chain: (chain) => chain.id === 8453,
      account: () => true,
      calls: () => true,
    })
    expect(result).toBe(true)
  })

  it('AND-composes all filters (one fails)', async () => {
    const result = await shouldSponsor(validIntentInput, {
      chain: (chain) => chain.id === 8453,
      account: () => false,
      calls: () => true,
    })
    expect(result).toBe(false)
  })

  it('supports async predicates', async () => {
    const result = await shouldSponsor(validIntentInput, {
      account: async (addr) => {
        await new Promise((r) => setTimeout(r, 1))
        return addr === '0x1234000000000000000000000000000000000000'
      },
    })
    expect(result).toBe(true)
  })

  it('short-circuits on first failing filter', async () => {
    let callsFilterCalled = false
    await shouldSponsor(validIntentInput, {
      chain: () => false,
      calls: () => {
        callsFilterCalled = true
        return true
      },
    })
    expect(callsFilterCalled).toBe(false)
  })

  it('throws on invalid input', async () => {
    await expect(shouldSponsor(null, {})).rejects.toThrow(
      'intentInput must be a non-null object',
    )
    await expect(
      shouldSponsor({ destinationChainId: 'not-a-number' }, {}),
    ).rejects.toThrow('intentInput.destinationChainId must be a number')
  })
})

describe('createJwtSigner', () => {
  async function makeTestConfig() {
    const { privateKey } = await generateKeyPair('RS256', {
      extractable: true,
    })
    const jwk = await exportJWK(privateKey)
    return {
      jwt: {
        privateKey: jwk,
        integratorId: 'test-integrator',
        projectId: 'test-project',
        appId: 'test-app',
        keyId: 'test-key',
      },
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
    const signer = createJwtSigner({
      jwt: { ...config.jwt, audience: 'custom-audience' },
    })
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

  it('signs normally when shouldSponsor filters all pass', async () => {
    const config = await makeTestConfig()
    const signer = createJwtSigner({
      ...config,
      shouldSponsor: {
        chain: (chain) => chain.id === 8453,
        account: () => true,
      },
    })
    const intentInput = {
      account: { address: '0x1234000000000000000000000000000000000000' },
      destinationChainId: 8453,
      destinationExecutions: [
        {
          to: '0xaaaa000000000000000000000000000000000000',
          value: '0',
          data: '0x',
        },
      ],
    }
    const token = await signer.getIntentExtensionToken(intentInput)

    const payload = decodeJwt(token) as any
    expect(payload.typ).toBe('intent_extension')
  })

  it('throws SponsorshipDeniedError when a filter rejects', async () => {
    const config = await makeTestConfig()
    const signer = createJwtSigner({
      ...config,
      shouldSponsor: {
        chain: (chain) => chain.id === 1,
      },
    })
    const intentInput = {
      account: { address: '0x1234000000000000000000000000000000000000' },
      destinationChainId: 8453,
      destinationExecutions: [
        {
          to: '0xaaaa000000000000000000000000000000000000',
          value: '0',
          data: '0x',
        },
      ],
    }

    await expect(signer.getIntentExtensionToken(intentInput)).rejects.toThrow(
      SponsorshipDeniedError,
    )
  })

  it('propagates parse errors from invalid intent input when filters are present', async () => {
    const config = await makeTestConfig()
    const signer = createJwtSigner({
      ...config,
      shouldSponsor: { chain: () => true },
    })

    await expect(signer.getIntentExtensionToken(null)).rejects.toThrow(
      'intentInput must be a non-null object',
    )
  })

  async function makeEcTestConfig(alg: 'ES256' | 'ES384' | 'ES512') {
    const { privateKey, publicKey } = await generateKeyPair(alg, {
      extractable: true,
    })
    const privateJwk = await exportJWK(privateKey)
    const publicJwk = await exportJWK(publicKey)
    return {
      config: {
        jwt: {
          privateKey: privateJwk,
          integratorId: 'test-integrator',
          projectId: 'test-project',
          appId: 'test-app',
          keyId: 'test-key',
        },
      },
      publicJwk,
    }
  }

  it.each(['ES256', 'ES384', 'ES512'] as const)(
    'mints a %s-signed accessToken that verifies against the public JWK',
    async (alg) => {
      const { config, publicJwk } = await makeEcTestConfig(alg)
      const signer = createJwtSigner(config)
      const token = await signer.accessToken()

      const header = decodeProtectedHeader(token)
      expect(header.alg).toBe(alg)
      expect(header.kid).toBe('test-key')

      const publicKey = await importJWK(publicJwk, alg)
      const { payload } = await jwtVerify(token, publicKey)
      expect(payload.iss).toBe('test-integrator')
      expect(payload.sub).toBe('test-project')
    },
  )

  it('mints an ES256-signed intent extension token', async () => {
    const { config } = await makeEcTestConfig('ES256')
    const signer = createJwtSigner(config)
    const token = await signer.getIntentExtensionToken({ amount: '1' })

    const header = decodeProtectedHeader(token)
    expect(header.alg).toBe('ES256')
    expect(header.kid).toBe('test-key')
  })

  it('throws at construction for unsupported JWK kty (OKP)', () => {
    const badJwk = {
      kty: 'OKP',
      crv: 'Ed25519',
      x: 'AAAA',
      d: 'AAAA',
    } as unknown as JsonWebKey
    expect(() =>
      createJwtSigner({
        jwt: {
          privateKey: badJwk,
          integratorId: 'i',
          projectId: 'p',
          appId: 'a',
          keyId: 'k',
        },
      }),
    ).toThrow(/Unsupported JWK kty/)
  })

  it('throws at construction for unsupported EC curve', () => {
    const badJwk = {
      kty: 'EC',
      crv: 'P-999',
      x: 'AAAA',
      y: 'AAAA',
      d: 'AAAA',
    } as unknown as JsonWebKey
    expect(() =>
      createJwtSigner({
        jwt: {
          privateKey: badJwk,
          integratorId: 'i',
          projectId: 'p',
          appId: 'a',
          keyId: 'k',
        },
      }),
    ).toThrow(/Unsupported EC curve/)
  })
})
