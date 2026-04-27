import { createJwtSigner, type JwtSignerConfig } from './signer'
import { SponsorshipDeniedError } from './sponsorship'

export type JwtHandlerConfig = JwtSignerConfig

interface HandlerResult {
  status: number
  body: Record<string, unknown>
}

export function createCoreAccessTokenHandler(
  config: JwtHandlerConfig,
): () => Promise<HandlerResult> {
  const signer = createJwtSigner(config)

  return async () => {
    try {
      const token = await signer.accessToken()
      return { status: 200, body: { token } }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Internal server error'
      return { status: 500, body: { error: message } }
    }
  }
}

export function createCoreExtensionTokenHandler(
  config: JwtHandlerConfig,
): (intentInput: unknown) => Promise<HandlerResult> {
  const signer = createJwtSigner(config)

  return async (intentInput: unknown) => {
    if (intentInput === undefined || intentInput === null) {
      return {
        status: 400,
        body: { error: 'Missing intentInput in request body' },
      }
    }

    try {
      const token = await signer.getIntentExtensionToken(intentInput)
      return { status: 200, body: { token } }
    } catch (error) {
      if (error instanceof SponsorshipDeniedError) {
        return { status: 403, body: { error: error.message } }
      }
      const message =
        error instanceof Error ? error.message : 'Internal server error'
      return { status: 500, body: { error: message } }
    }
  }
}
