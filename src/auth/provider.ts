import type {
  AuthConfig,
  RhinestoneConfig,
  RhinestoneSDKConfig,
} from '../types'

export interface AuthProvider {
  getHeaders(): Promise<Record<string, string>>
  getSubmitHeaders(
    intentInput: unknown,
    isSponsored: boolean,
  ): Promise<Record<string, string>>
}

export function createAuthProvider(
  config: RhinestoneSDKConfig | RhinestoneConfig,
): AuthProvider {
  const resolved = resolveAuth(config)

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
      return { Authorization: `Bearer ${token}`, 'x-api-key': 'jwt' }
    },

    async getSubmitHeaders(intentInput: unknown, isSponsored: boolean) {
      const token = await resolveAccessToken()
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'x-api-key': 'jwt',
      }

      if (isSponsored && getIntentExtensionToken) {
        const extensionToken = await getIntentExtensionToken(intentInput)
        headers['X-Intent-Extension'] = `Bearer ${extensionToken}`
      }

      return headers
    },
  }
}

function resolveAuth(
  config: RhinestoneSDKConfig | RhinestoneConfig,
): AuthConfig {
  if ('auth' in config && config.auth) return config.auth

  if ('apiKey' in config && config.apiKey) {
    return { mode: 'apiKey', apiKey: config.apiKey }
  }

  throw new Error('RhinestoneSDK requires either `apiKey` or `auth` in config')
}
