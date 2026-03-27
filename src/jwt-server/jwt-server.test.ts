import { createServer, type Server } from 'node:http'
import { generateKeyPair } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEndpointAuthProvider } from '../auth/endpoint-provider'
import { createAuthProvider } from '../auth/provider'
import { computeIntentInputDigest } from './digest'
import {
  createAccessTokenHandler,
  createExtensionTokenHandler,
} from './handlers'
import { jcsCanonicalise } from './jcs'
import { createJwtSigner } from './signer'

const VALID_SESSION_TOKEN = 'session_test_abc123'

/** Adapt a Web Response handler to a Node http.Server. */
function serveHandler(handler: (req: Request) => Promise<Response>): Server {
  return createServer(async (req, res) => {
    const url = `http://localhost${req.url}`
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value[0] : value)
    }

    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined

    const webReq = new Request(url, {
      method: req.method,
      headers,
      body,
    })

    const webRes = await handler(webReq)
    const resBody = await webRes.text()

    res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()))
    res.end(resBody)
  })
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address()
      resolve(typeof addr === 'object' ? addr!.port : 0)
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

describe('jwt-server round-trip', () => {
  let server: Server
  let baseUrl: string
  let accessRequestCount: number

  beforeAll(async () => {
    const { privateKey } = await generateKeyPair('RS256')

    const signer = createJwtSigner({
      privateKey,
      integratorId: 'int_test',
      projectId: 'proj_test',
      appId: 'app_test',
      keyId: 'key_test',
    })

    accessRequestCount = 0

    const accessHandler = createAccessTokenHandler({
      signer,
      authorize: async (headers) => {
        return headers.get('authorization') === `Bearer ${VALID_SESSION_TOKEN}`
      },
      expiresIn: '1h',
    })

    const extensionHandler = createExtensionTokenHandler({
      signer,
      authorize: async (headers, _intentInput) => {
        return headers.get('authorization') === `Bearer ${VALID_SESSION_TOKEN}`
      },
    })

    server = serveHandler(async (req) => {
      const url = new URL(req.url)
      if (url.pathname === '/token') {
        accessRequestCount++
        return accessHandler(req)
      }
      if (url.pathname === '/extension-token') {
        return extensionHandler(req)
      }
      return new Response('Not found', { status: 404 })
    })

    const port = await listen(server)
    baseUrl = `http://localhost:${port}`
  })

  afterAll(async () => {
    if (server) await close(server)
  })

  it('fetches access token and returns Authorization header', async () => {
    const provider = createEndpointAuthProvider({
      mode: 'jwt-endpoint',
      tokenEndpoint: `${baseUrl}/token`,
      endpointHeaders: { Authorization: `Bearer ${VALID_SESSION_TOKEN}` },
      refreshBufferSeconds: 0,
    })

    const headers = await provider.getHeaders()

    expect(headers.Authorization).toBeDefined()
    expect(headers.Authorization).toMatch(/^Bearer eyJ/)
  })

  it('fetches extension token for sponsored intents', async () => {
    const provider = createEndpointAuthProvider({
      mode: 'jwt-endpoint',
      tokenEndpoint: `${baseUrl}/token`,
      extensionTokenEndpoint: `${baseUrl}/extension-token`,
      endpointHeaders: { Authorization: `Bearer ${VALID_SESSION_TOKEN}` },
      refreshBufferSeconds: 0,
    })

    const intentInput = { transfers: [{ token: 'USDC', amount: '1000000' }] }
    const headers = await provider.getSubmitHeaders(intentInput, true)

    expect(headers.Authorization).toMatch(/^Bearer eyJ/)
    expect(headers['X-Intent-Extension']).toBeDefined()
    expect(headers['X-Intent-Extension']).toMatch(/^Bearer eyJ/)
  })

  it('throws when server rejects authorization', async () => {
    const provider = createEndpointAuthProvider({
      mode: 'jwt-endpoint',
      tokenEndpoint: `${baseUrl}/token`,
      endpointHeaders: { Authorization: 'Bearer wrong_token' },
      refreshBufferSeconds: 0,
    })

    await expect(provider.getHeaders()).rejects.toThrow(/403/)
  })

  it('caches access token on subsequent calls', async () => {
    accessRequestCount = 0

    const provider = createEndpointAuthProvider({
      mode: 'jwt-endpoint',
      tokenEndpoint: `${baseUrl}/token`,
      endpointHeaders: { Authorization: `Bearer ${VALID_SESSION_TOKEN}` },
      refreshBufferSeconds: 0,
    })

    const headers1 = await provider.getHeaders()
    const headers2 = await provider.getHeaders()

    expect(headers1.Authorization).toBe(headers2.Authorization)
    expect(accessRequestCount).toBe(1)
  })

  it('skips extension token when intent is not sponsored', async () => {
    const provider = createEndpointAuthProvider({
      mode: 'jwt-endpoint',
      tokenEndpoint: `${baseUrl}/token`,
      extensionTokenEndpoint: `${baseUrl}/extension-token`,
      endpointHeaders: { Authorization: `Bearer ${VALID_SESSION_TOKEN}` },
      refreshBufferSeconds: 0,
    })

    const intentInput = { transfers: [{ token: 'USDC', amount: '1000000' }] }
    const headers = await provider.getSubmitHeaders(intentInput, false)

    expect(headers.Authorization).toMatch(/^Bearer eyJ/)
    expect(headers['X-Intent-Extension']).toBeUndefined()
  })

  it('passes custom endpoint headers to server authorize callback', async () => {
    const customToken = 'session_custom_xyz'

    const { privateKey } = await generateKeyPair('RS256')
    const signer = createJwtSigner({
      privateKey,
      integratorId: 'int_test',
      projectId: 'proj_test',
      appId: 'app_test',
      keyId: 'key_test',
    })

    const handler = createAccessTokenHandler({
      signer,
      authorize: async (headers) => {
        return headers.get('x-custom-auth') === customToken
      },
    })

    const customServer = serveHandler(handler)
    const port = await listen(customServer)

    try {
      const provider = createEndpointAuthProvider({
        mode: 'jwt-endpoint',
        tokenEndpoint: `http://localhost:${port}/token`,
        endpointHeaders: { 'X-Custom-Auth': customToken },
        refreshBufferSeconds: 0,
      })

      const headers = await provider.getHeaders()
      expect(headers.Authorization).toMatch(/^Bearer eyJ/)
    } finally {
      await close(customServer)
    }
  })

  it('supports dynamic endpoint headers via callback', async () => {
    let callCount = 0
    const provider = createEndpointAuthProvider({
      mode: 'jwt-endpoint',
      tokenEndpoint: `${baseUrl}/token`,
      endpointHeaders: async () => {
        callCount++
        return { Authorization: `Bearer ${VALID_SESSION_TOKEN}` }
      },
      refreshBufferSeconds: 0,
    })

    const headers = await provider.getHeaders()

    expect(headers.Authorization).toMatch(/^Bearer eyJ/)
    expect(callCount).toBe(1)
  })

  it('refreshes expired access token', async () => {
    accessRequestCount = 0

    const provider = createEndpointAuthProvider({
      mode: 'jwt-endpoint',
      tokenEndpoint: `${baseUrl}/token`,
      endpointHeaders: { Authorization: `Bearer ${VALID_SESSION_TOKEN}` },
      // Set buffer higher than the token lifetime so it always looks expired
      refreshBufferSeconds: 9999,
    })

    await provider.getHeaders()
    await provider.getHeaders()

    // Should have fetched twice because the token always looks expired
    expect(accessRequestCount).toBe(2)
  })

  it('handler rejects non-POST requests with 405', async () => {
    const response = await fetch(`${baseUrl}/token`, { method: 'GET' })

    expect(response.status).toBe(405)
    const body = await response.json()
    expect(body.error).toBe('method_not_allowed')
  })

  it('extension handler rejects missing intent_input with 400', async () => {
    const response = await fetch(`${baseUrl}/extension-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VALID_SESSION_TOKEN}`,
      },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('bad_request')
    expect(body.error_description).toMatch(/intent_input/)
  })
})

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
