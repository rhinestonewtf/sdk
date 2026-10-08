import {
  createCoreAccessTokenHandler,
  createCoreExtensionTokenHandler,
  type JwtHandlerConfig,
} from './handlers'

interface ExpressRequest {
  method: string
  url: string
  body?: unknown
}

interface ExpressResponse {
  status(code: number): ExpressResponse
  json(body: unknown): unknown
}

type ExpressNext = (error?: unknown) => void

type ExpressMiddleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: ExpressNext,
) => void

// Mirrors Express Router's default matching (case-insensitive, optional
// trailing slash, query ignored) without importing express.
function routePath(url: string): string {
  const path = url.split('?')[0].toLowerCase()
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

export function createExpressRouter(
  config: JwtHandlerConfig,
): ExpressMiddleware {
  const handleAccessToken = createCoreAccessTokenHandler(config)
  const handleExtensionToken = createCoreExtensionTokenHandler(config)

  return (req, res, next) => {
    const path = routePath(req.url)
    let work: (() => Promise<void>) | undefined

    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      path === '/access-token'
    ) {
      work = async () => {
        const result = await handleAccessToken()
        res.status(result.status).json(result.body)
      }
    } else if (req.method === 'POST' && path === '/extension-token') {
      work = async () => {
        const body = req.body as Record<string, unknown> | undefined
        const result = await handleExtensionToken(body?.intentInput)
        res.status(result.status).json(result.body)
      }
    }

    if (!work) {
      next()
      return
    }
    work().catch(next)
  }
}
