import type { ResolvedAuth } from '../../config/resolved'

export interface OrchestratorAuthPort {
  readonly getHeaders: () => Promise<Readonly<Record<string, string>>>
  readonly getSubmitHeaders: (
    intentInput: unknown,
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
      getSubmitHeaders: async () => headers,
    }
  }

  const accessToken = async (): Promise<string> =>
    typeof auth.accessToken === 'function'
      ? await auth.accessToken()
      : auth.accessToken
  const headers = async (): Promise<Record<string, string>> => ({
    Authorization: `Bearer ${await accessToken()}`,
    'x-api-key': 'jwt',
  })
  return {
    getHeaders: headers,
    getSubmitHeaders: async (intentInput, sponsored) => ({
      ...(await headers()),
      ...(sponsored && auth.getIntentExtensionToken
        ? {
            'X-Intent-Extension': `Bearer ${await auth.getIntentExtensionToken(intentInput)}`,
          }
        : {}),
    }),
  }
}
