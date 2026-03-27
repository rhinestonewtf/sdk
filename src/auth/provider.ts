import type { AuthConfig } from '../types'
import { createEndpointAuthProvider } from './endpoint-provider'

export interface AuthProvider {
  getHeaders(): Promise<Record<string, string>>
  getSubmitHeaders(
    intentInput: unknown,
    isSponsored: boolean,
  ): Promise<Record<string, string>>
}

export function createAuthProvider(config: {
  apiKey?: string
  auth?: AuthConfig
}): AuthProvider {
  const resolved = resolveAuth(config)

  if (resolved.mode === 'jwt-endpoint') {
    return createEndpointAuthProvider(resolved)
  }

  if (resolved.mode === 'apiKey') {
    const headers: Record<string, string> = { 'x-api-key': resolved.apiKey }
    return {
      getHeaders: async () => headers,
      getSubmitHeaders: async () => headers,
    }
  }

  const { accessToken, getIntentExtensionToken } = resolved

  const resolveAccessToken = async (): Promise<string> =>
    typeof accessToken === 'function' ? await accessToken() : accessToken

  return {
    async getHeaders() {
      const token = await resolveAccessToken()
      return { Authorization: `Bearer ${token}` }
    },

    async getSubmitHeaders(intentInput: unknown, isSponsored: boolean) {
      const token = await resolveAccessToken()
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      }

      if (isSponsored && getIntentExtensionToken) {
        const extensionToken = await getIntentExtensionToken(intentInput)
        headers['X-Intent-Extension'] = `Bearer ${extensionToken}`
      }

      return headers
    },
  }
}

function resolveAuth(config: {
  apiKey?: string
  auth?: AuthConfig
}): AuthConfig {
  if (config.auth) return config.auth

  if (config.apiKey) {
    return { mode: 'apiKey', apiKey: config.apiKey }
  }

  throw new Error('RhinestoneSDK requires either `apiKey` or `auth` in config')
}
