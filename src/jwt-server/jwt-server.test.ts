import { describe, expect, it } from 'vitest'
import { createAuthProvider } from '../auth/provider'
import { computeIntentInputDigest } from './digest'
import { jcsCanonicalise } from './jcs'

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
    expect(headers['x-api-key']).toBeUndefined()
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

  it('coerces BigInt to string', () => {
    expect(jcsCanonicalise({ amount: BigInt('1000000') })).toBe(
      '{"amount":1000000}',
    )
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
