import { createJwtSigner, type JwtSignerConfig } from './signer'
import {
  shouldSponsor as checkSponsor,
  type SponsorshipFilter,
} from './sponsorship'

export interface JwtHandlerConfig extends JwtSignerConfig {
  shouldSponsor?: SponsorshipFilter
}

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
  const filters = config.shouldSponsor

  return async (intentInput: unknown) => {
    if (intentInput === undefined || intentInput === null) {
      return {
        status: 400,
        body: { error: 'Missing intentInput in request body' },
      }
    }

    if (filters) {
      try {
        const allowed = await checkSponsor(intentInput, filters)
        if (!allowed) {
          return { status: 403, body: { error: 'Sponsorship denied' } }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Invalid intent input'
        return { status: 400, body: { error: message } }
      }
    }

    try {
      const token = await signer.getIntentExtensionToken(intentInput)
      return { status: 200, body: { token } }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Internal server error'
      return { status: 500, body: { error: message } }
    }
  }
}
