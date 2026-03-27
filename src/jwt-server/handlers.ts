import type { JwtSigner } from './signer'

export interface AccessTokenHandlerConfig {
  signer: JwtSigner
  authorize: (headers: Headers) => Promise<boolean>
  /** Token lifetime (jose-style duration, e.g. `'1h'`, `'30m'`). Defaults to `'1h'`. */
  expiresIn?: string
}

export interface ExtensionTokenHandlerConfig {
  signer: JwtSigner
  authorize: (headers: Headers, intentInput: unknown) => Promise<boolean>
}

export function createAccessTokenHandler(
  config: AccessTokenHandlerConfig,
): (request: Request) => Promise<Response> {
  const expiresIn = config.expiresIn ?? '1h'
  const expiresInSeconds = parseDurationToSeconds(expiresIn)

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return errorResponse('method_not_allowed', 'Use POST', 405, {
        Allow: 'POST',
      })
    }

    let authorized: boolean
    try {
      authorized = await config.authorize(request.headers)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Authorization denied'
      return errorResponse('forbidden', message, 403)
    }
    if (!authorized) {
      return errorResponse('forbidden', 'Authorization denied', 403)
    }

    try {
      const token = await config.signer.signAccessToken({ expiresIn })
      return jsonResponse({ access_token: token, expires_in: expiresInSeconds })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Token signing failed'
      return errorResponse('internal_error', message, 500)
    }
  }
}

export function createExtensionTokenHandler(
  config: ExtensionTokenHandlerConfig,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return errorResponse('method_not_allowed', 'Use POST', 405, {
        Allow: 'POST',
      })
    }

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return errorResponse('bad_request', 'Invalid JSON body', 400)
    }

    const intentInput = body.intent_input
    if (intentInput === undefined) {
      return errorResponse(
        'bad_request',
        'Missing "intent_input" in request body',
        400,
      )
    }

    let authorized: boolean
    try {
      authorized = await config.authorize(request.headers, intentInput)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Authorization denied'
      return errorResponse('forbidden', message, 403)
    }
    if (!authorized) {
      return errorResponse('forbidden', 'Authorization denied', 403)
    }

    try {
      const token = await config.signer.signIntentExtensionToken(intentInput)
      return jsonResponse({ access_token: token, expires_in: 300 })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Token signing failed'
      return errorResponse('internal_error', message, 500)
    }
  }
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

function errorResponse(
  error: string,
  description: string,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return jsonResponse(
    { error, error_description: description },
    status,
    extraHeaders,
  )
}

function parseDurationToSeconds(duration: string): number {
  const match = duration.match(/^(\d+)\s*(s|m|h|d)$/)
  if (!match) {
    throw new Error(`Invalid duration format: "${duration}"`)
  }
  const value = Number(match[1])
  switch (match[2]) {
    case 's':
      return value
    case 'm':
      return value * 60
    case 'h':
      return value * 3600
    case 'd':
      return value * 86400
    default:
      throw new Error(`Unknown duration unit: ${match[2]}`)
  }
}
