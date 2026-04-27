import { createRequire } from 'node:module'
import {
  createCoreAccessTokenHandler,
  createCoreExtensionTokenHandler,
  type JwtHandlerConfig,
} from './handlers'

const require = createRequire(import.meta.url)

interface ExpressRequest {
  body?: unknown
}

interface ExpressResponse {
  status(code: number): ExpressResponse
  json(body: unknown): void
}

type ExpressHandler = (req: ExpressRequest, res: ExpressResponse) => void

interface ExpressRouter {
  get(path: string, handler: ExpressHandler): ExpressRouter
  post(path: string, handler: ExpressHandler): ExpressRouter
}

export function createExpressRouter(config: JwtHandlerConfig): ExpressRouter {
  // Dynamic import avoidance: we type the router interface manually
  // so express doesn't need to be installed unless this function is called.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Router } = require('express') as {
    Router: () => ExpressRouter
  }
  const router = Router()

  const handleAccessToken = createCoreAccessTokenHandler(config)
  const handleExtensionToken = createCoreExtensionTokenHandler(config)

  router.get('/access-token', async (_req, res) => {
    const result = await handleAccessToken()
    res.status(result.status).json(result.body)
  })

  router.post('/extension-token', async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined
    const intentInput = body?.intentInput
    const result = await handleExtensionToken(intentInput)
    res.status(result.status).json(result.body)
  })

  return router
}
