import type { ResolvedAuth } from '../../config/resolved'
import type { SerializedIntentInput } from './public'

export interface OrchestratorAuthPort {
  readonly getHeaders: () => Promise<Readonly<Record<string, string>>>
  /**
   * Whether a quote with this sponsorship flag would carry an intent-scoped
   * grant, so the caller can check the approval input binds the body first.
   */
  readonly requestsIntentExtension: (sponsored: boolean) => boolean
  readonly getQuoteHeaders: (
    intentInput: SerializedIntentInput,
    sponsored: boolean,
  ) => Promise<Readonly<Record<string, string>>>
}

export function createOrchestratorAuth(
  auth: ResolvedAuth,
): OrchestratorAuthPort {
  if (auth.kind === 'api-key') {
    const headers = Object.freeze({ 'x-api-key': auth.apiKey })
    return {
      getHeaders: async () => headers,
      requestsIntentExtension: () => false,
      getQuoteHeaders: async () => headers,
    }
  }

  const accessToken = async (): Promise<string> =>
    typeof auth.accessToken === 'function'
      ? await auth.accessToken()
      : auth.accessToken
  const headers = async (): Promise<Record<string, string>> => ({
    Authorization: `Bearer ${await accessToken()}`,
  })
  return {
    getHeaders: headers,
    requestsIntentExtension: (sponsored) =>
      sponsored && auth.getIntentExtensionToken !== undefined,
    getQuoteHeaders: async (intentInput, sponsored) => ({
      ...(await headers()),
      ...(sponsored && auth.getIntentExtensionToken
        ? {
            'X-Intent-Extension': `Bearer ${await auth.getIntentExtensionToken(intentInput)}`,
          }
        : {}),
    }),
  }
}
