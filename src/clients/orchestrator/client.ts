import { formatCaip2 } from '../../chains/caip2'
import type { ResolvedSdkConfig } from '../../config/resolved'
import type { OrchestratorAuthPort } from './auth'
import { createOrchestratorAuth } from './auth'
import { type FetchPort, fetchOrchestratorJson } from './fetch'
import {
  mapIntentRequestToWire,
  mapIntentStatusFromWire,
  mapPortfolioFromWire,
  mapQuoteResponseFromWire,
  mapSignedIntentToWire,
  mapSplitRequestToWire,
  mapSplitResultFromWire,
} from './mappers'
import type { OrchestratorPort } from './port'

const SDK_VERSION = '2.0.0-beta.43'
const API_VERSION = '2026-04.blanc'

export interface OrchestratorClientOptions {
  readonly url: string
  readonly auth: OrchestratorAuthPort
  readonly headers?: Readonly<Record<string, string>>
  readonly fetch?: FetchPort
}

export function createOrchestratorClient(
  options: OrchestratorClientOptions,
): OrchestratorPort {
  const fetchPort = options.fetch ?? globalThis.fetch
  const request = async (input: {
    readonly path: string
    readonly method?: 'GET' | 'POST'
    readonly body?: unknown
    readonly submitContext?: {
      readonly intentInput: unknown
      readonly sponsored: boolean
    }
  }): Promise<unknown> => {
    const authHeaders = input.submitContext
      ? await options.auth.getSubmitHeaders(
          input.submitContext.intentInput,
          input.submitContext.sponsored,
        )
      : await options.auth.getHeaders()
    return fetchOrchestratorJson({
      fetch: fetchPort,
      url: new URL(input.path, withTrailingSlash(options.url)).toString(),
      init: {
        method: input.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-sdk-version': SDK_VERSION,
          'x-api-version': API_VERSION,
          ...authHeaders,
          ...options.headers,
        },
        ...(input.body === undefined
          ? {}
          : { body: JSON.stringify(input.body) }),
      },
    })
  }

  return {
    createQuote: async (input) =>
      mapQuoteResponseFromWire(
        await request({
          path: 'quotes',
          method: 'POST',
          body: mapIntentRequestToWire(input),
        }),
      ),
    submitIntent: async (input, context) => {
      const value = (await request({
        path: 'intents',
        method: 'POST',
        body: mapSignedIntentToWire(input),
        ...(context ? { submitContext: context } : {}),
      })) as { readonly traceId?: string; readonly intentId?: string }
      return { traceId: value.traceId ?? '', intentId: value.intentId ?? '' }
    },
    getIntentStatus: async (intentId) =>
      mapIntentStatusFromWire(
        intentId,
        await request({ path: `intents/${encodeURIComponent(intentId)}` }),
      ),
    splitIntents: async (input) =>
      mapSplitResultFromWire(
        await request({
          path: 'intents/splits',
          method: 'POST',
          body: mapSplitRequestToWire(input),
        }),
      ),
    getPortfolio: async (input) => {
      const params = new URLSearchParams()
      for (const chainId of input.chainIds ?? []) {
        params.append('chainIds', formatCaip2(chainId))
      }
      for (const [chainId, tokens] of Object.entries(input.tokens ?? {})) {
        for (const token of tokens) {
          params.append('tokens', `${formatCaip2(Number(chainId))}:${token}`)
        }
      }
      const suffix = params.size > 0 ? `?${params}` : ''
      return mapPortfolioFromWire(
        await request({
          path: `accounts/${input.account}/portfolio${suffix}`,
        }),
      )
    },
    getAppFeeBalances: async () => {
      const value = (await request({ path: 'app-fees/balances' })) as {
        readonly withdrawableUsd?: number
        readonly pendingUsd?: number
      }
      return {
        withdrawableUsd: value.withdrawableUsd ?? 0,
        pendingUsd: value.pendingUsd ?? 0,
      }
    },
  }
}

export function createConfiguredOrchestratorClient(
  config: ResolvedSdkConfig,
  fetch?: FetchPort,
): OrchestratorPort {
  return createOrchestratorClient({
    url: config.orchestratorUrl,
    auth: createOrchestratorAuth(config.auth),
    headers: config.headers,
    ...(fetch ? { fetch } : {}),
  })
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}
