import type { JwtEndpointAuth } from '../types'
import type { AuthProvider } from './provider'

interface CachedToken {
  token: string
  expiresAt: number
}

interface TokenResponse {
  access_token: string
  expires_in: number
}

export function createEndpointAuthProvider(
  config: JwtEndpointAuth,
): AuthProvider {
  let cached: CachedToken | null = null
  let inflight: Promise<CachedToken> | null = null
  const refreshBuffer = (config.refreshBufferSeconds ?? 60) * 1000

  async function resolveEndpointHeaders(): Promise<Record<string, string>> {
    if (!config.endpointHeaders) return {}
    if (typeof config.endpointHeaders === 'function') {
      return await config.endpointHeaders()
    }
    return config.endpointHeaders
  }

  async function fetchToken(
    url: string,
    body?: unknown,
  ): Promise<TokenResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(await resolveEndpointHeaders()),
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      credentials: config.credentials,
      body: body != null ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      let detail: string
      try {
        detail = await response.text()
      } catch {
        detail = response.statusText
      }
      throw new Error(
        `Token endpoint ${url} returned ${response.status}: ${detail}`,
      )
    }

    const json = await response.json()

    if (
      typeof json.access_token !== 'string' ||
      typeof json.expires_in !== 'number'
    ) {
      throw new Error(
        `Token endpoint ${url} returned invalid response: expected { access_token: string, expires_in: number }`,
      )
    }

    return json as TokenResponse
  }

  async function refreshAccessToken(): Promise<CachedToken> {
    const { access_token, expires_in } = await fetchToken(config.tokenEndpoint)
    const result: CachedToken = {
      token: access_token,
      expiresAt: Date.now() + expires_in * 1000,
    }
    cached = result
    return result
  }

  async function getAccessToken(): Promise<string> {
    if (cached && Date.now() < cached.expiresAt - refreshBuffer) {
      return cached.token
    }

    if (!inflight) {
      inflight = refreshAccessToken().finally(() => {
        inflight = null
      })
    }

    const result = await inflight
    return result.token
  }

  return {
    async getHeaders() {
      const token = await getAccessToken()
      return { Authorization: `Bearer ${token}` }
    },

    async getSubmitHeaders(intentInput: unknown, isSponsored: boolean) {
      const token = await getAccessToken()
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      }

      if (isSponsored && config.extensionTokenEndpoint) {
        const ext = await fetchToken(config.extensionTokenEndpoint, {
          intent_input: intentInput,
        })
        headers['X-Intent-Extension'] = `Bearer ${ext.access_token}`
      }

      return headers
    },
  }
}
