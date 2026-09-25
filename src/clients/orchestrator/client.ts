import { formatCaip2 } from '../../chains/caip2'
import type { ResolvedSdkConfig } from '../../config/resolved'
import type { OrchestratorAuthPort } from './auth'
import { createOrchestratorAuth } from './auth'
import { ChainCatalog, parseChains } from './chain-catalog'
import { type FetchPort, fetchOrchestratorJson } from './fetch'
import {
  mapIntentRequestToWire,
  mapIntentStatusFromWire,
  mapIntentSubmissionFromWire,
  mapPortfolioFromWire,
  mapQuoteResponseFromWire,
  mapSignedIntentToWire,
  mapSplitRequestToWire,
  mapSplitResultFromWire,
} from './mappers'
import type { OrchestratorPort } from './port'
import { assertSponsorshipApproval } from './sponsorship-approval'
import type { OrchestratorQuoteContext } from './types'
import type { WireChainsResponse } from './wire'

const SDK_VERSION = '2.16.1'
const API_VERSION = '2026-09.caucasus'

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
    readonly quoteContext?: OrchestratorQuoteContext
  }): Promise<unknown> => {
    const authHeaders = input.quoteContext
      ? await options.auth.getQuoteHeaders(
          input.quoteContext.intentInput,
          input.quoteContext.sponsored,
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

  // Memoized so the chain catalog is fetched at most once per client, lazily on
  // first use — never at account construction.
  let chainCatalogPromise: Promise<ChainCatalog> | undefined

  return {
    createQuote: async (input, context) => {
      // One body object: the approval is checked against exactly the bytes
      // that are sent, before the integrator is asked for a grant.
      const body = mapIntentRequestToWire(input)
      if (context && options.auth.requestsIntentExtension(context.sponsored)) {
        assertSponsorshipApproval(body, context.intentInput)
      }
      return mapQuoteResponseFromWire(
        await request({
          path: 'quotes',
          method: 'POST',
          body,
          ...(context ? { quoteContext: context } : {}),
        }),
      )
    },
    // Never carries the intent extension: the grant was presented with the
    // quote and is single-use, so the submission bills from the quoted fees.
    submitIntent: async (input) =>
      mapIntentSubmissionFromWire(
        input.intentId,
        await request({
          path: 'intents',
          method: 'POST',
          body: mapSignedIntentToWire(input),
        }),
      ),
    getIntentStatus: async (intentId, options) =>
      mapIntentStatusFromWire(
        intentId,
        await request({
          path: `intents/${encodeURIComponent(intentId)}${
            options?.full ? '?full=true' : ''
          }`,
        }),
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
    getChainCatalog: () => {
      chainCatalogPromise ??= (async () => {
        const json = (await request({ path: 'chains' })) as WireChainsResponse
        return new ChainCatalog(parseChains(json))
      })()
      return chainCatalogPromise
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
