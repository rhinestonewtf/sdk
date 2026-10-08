import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express4 from 'express4'
import express5 from 'express5'
import { decodeJwt, exportJWK, generateKeyPair } from 'jose'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createExpressRouter } from './express'
import type { JwtHandlerConfig } from './handlers'

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

async function makeConfig(): Promise<JwtHandlerConfig> {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true })
  return {
    jwt: {
      privateKey: await exportJWK(privateKey),
      integratorId: 'test-integrator',
      projectId: 'test-project',
      appId: 'test-app',
      keyId: 'test-key',
    },
  }
}

interface Listener {
  listen(port: number, host: string): Server
}

// Each major builds its app separately: the two `Express` types do not unify.
function mountExpress4(config: JwtHandlerConfig): Listener {
  const app = express4()
  app.use('/jwt', express4.json(), createExpressRouter(config))
  app.use((_req, res) => {
    res.status(418).json({ fallthrough: true })
  })
  return app
}

function mountExpress5(config: JwtHandlerConfig): Listener {
  const app = express5()
  app.use('/jwt', express5.json(), createExpressRouter(config))
  app.use((_req, res) => {
    res.status(418).json({ fallthrough: true })
  })
  return app
}

describe.each([
  ['express 4', mountExpress4],
  ['express 5', mountExpress5],
])('createExpressRouter on %s', (_name, mount) => {
  const servers: Server[] = []
  let baseUrl: string
  let deniedUrl: string

  async function listen(config: JwtHandlerConfig): Promise<string> {
    const server = mount(config).listen(0, '127.0.0.1')
    servers.push(server)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const { port } = server.address() as AddressInfo
    return `http://127.0.0.1:${port}/jwt`
  }

  beforeAll(async () => {
    const config = await makeConfig()
    baseUrl = await listen(config)
    deniedUrl = await listen({
      ...config,
      shouldSponsor: { chain: (chain) => chain.id === 1 },
    })
  })

  afterAll(() => {
    for (const server of servers) server.close()
  })

  function postExtension(url: string, body: unknown) {
    return fetch(`${url}/extension-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('serves an access token on GET', async () => {
    const res = await fetch(`${baseUrl}/access-token`)
    expect(res.status).toBe(200)
    const { token } = await res.json()
    expect(decodeJwt(token).typ).toBe('access')
  })

  it.each(['/Access-Token/', '/access-token?x=1'])(
    'matches %s like Express Router',
    async (path) => {
      const res = await fetch(`${baseUrl}${path}`)
      expect(res.status).toBe(200)
    },
  )

  it('answers HEAD with headers only', async () => {
    const res = await fetch(`${baseUrl}/access-token`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it('serves an extension token on POST', async () => {
    const res = await postExtension(baseUrl, { intentInput })
    expect(res.status).toBe(200)
    const { token } = await res.json()
    expect(decodeJwt(token).typ).toBe('intent_extension')
  })

  it('rejects a missing intentInput', async () => {
    const res = await postExtension(baseUrl, {})
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Missing intentInput in request body',
    })
  })

  it('returns 403 when sponsorship is denied', async () => {
    const res = await postExtension(deniedUrl, { intentInput })
    expect(res.status).toBe(403)
  })

  it.each([
    ['POST', '/access-token'],
    ['GET', '/extension-token'],
    ['OPTIONS', '/access-token'],
    ['GET', '/other'],
  ])('passes %s %s to the next middleware', async (method, path) => {
    const res = await fetch(`${baseUrl}${path}`, { method })
    expect(res.status).toBe(418)
    expect(await res.json()).toEqual({ fallthrough: true })
  })
})

describe('createExpressRouter error handling', () => {
  it('forwards response failures to next', async () => {
    const middleware = createExpressRouter(await makeConfig())
    const failure = new Error('socket closed')
    const next = vi.fn()
    const res = {
      status: () => {
        throw failure
      },
      json: () => undefined,
    }

    middleware({ method: 'GET', url: '/access-token' }, res, next)

    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(failure))
  })
})
