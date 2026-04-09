import {
  createCoreAccessTokenHandler,
  createCoreExtensionTokenHandler,
  type JwtHandlerConfig,
} from './handlers'

export function createAccessTokenHandler(
  config: JwtHandlerConfig,
): (req: Request) => Promise<Response> {
  const handle = createCoreAccessTokenHandler(config)

  return async () => {
    const result = await handle()
    return Response.json(result.body, { status: result.status })
  }
}

export function createExtensionTokenHandler(
  config: JwtHandlerConfig,
): (req: Request) => Promise<Response> {
  const handle = createCoreExtensionTokenHandler(config)

  return async (req: Request) => {
    let intentInput: unknown
    try {
      const body = await req.json()
      intentInput = body.intentInput
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const result = await handle(intentInput)
    return Response.json(result.body, { status: result.status })
  }
}
