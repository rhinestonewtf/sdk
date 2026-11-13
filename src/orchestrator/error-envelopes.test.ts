import { afterEach, expect, test, vi } from 'vitest'
import envelopes from './__fixtures__/error-envelopes.json'
import { Orchestrator } from './client'
import {
  InsufficientLiquidityError,
  InvalidApiKeyError,
  isAuthError,
  isRateLimited,
  isRetryable,
  isValidationError,
  RateLimitedError,
} from './error'

const auth = {
  getHeaders: async () => ({}),
  getSubmitHeaders: async () => ({}),
}
const client = new Orchestrator('https://example.test', auth)

function respond(id: string, side: 'alps' | 'blanc') {
  const response = envelopes.find((entry) => entry.id === id)![side]
  const body = response.body as { __text?: string }
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(body.__text ?? JSON.stringify(body), {
          status: response.status,
          headers: {
            ...(response.traceId && { 'x-trace-id': response.traceId }),
            ...('retryAfter' in response && {
              'retry-after': response.retryAfter as string,
            }),
          },
        }),
    ),
  )
  return response
}

afterEach(() => vi.unstubAllGlobals())

test.each(['alps', 'blanc'] as const)(
  '%s auth errors retain classification and trace',
  async (side) => {
    const response = respond('status-invalid-api-key', side)
    const error = await client.getIntentOpStatus(1n).catch((error) => error)
    expect(error).toBeInstanceOf(InvalidApiKeyError)
    expect(error).toMatchObject({
      statusCode: 401,
      traceId: response.traceId,
      context: { traceId: response.traceId },
    })
    expect(isAuthError(error)).toBe(true)
    expect(isRetryable(error)).toBe(false)
  },
)

test.each(['alps', 'blanc'] as const)(
  '%s split liquidity errors expose bigint partial results',
  async (side) => {
    const response = respond('splits-insufficient-liquidity', side)
    const error = await client
      .splitIntents({ chain: { id: 421614 } as never, tokens: {} })
      .catch((error) => error)
    expect(error).toBeInstanceOf(InsufficientLiquidityError)
    expect(error).toMatchObject({
      statusCode: 422,
      traceId: response.traceId,
      availableIntents: [
        { '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d': 250075022506n },
      ],
      unfillable: {
        '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d': 9999749924977494n,
      },
    })
    expect(isValidationError(error)).toBe(true)
  },
)

test('plain text edge rate limits retain Retry-After rather than failing JSON parsing', async () => {
  respond('rate-limited', 'blanc')
  const error = await client.getIntentOpStatus(1n).catch((error) => error)
  expect(error).toBeInstanceOf(RateLimitedError)
  expect(error).toMatchObject({ statusCode: 429, context: { retryAfter: '2' } })
  expect(isRateLimited(error)).toBe(true)
})

test('header trace wins over body trace, nested CAIP-2 context becomes numeric, and server errors are retryable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: 'INTERNAL_ERROR',
            message: 'Relay quote failed',
            traceId: 'body',
            details: { candidateErrors: [{ chainId: 'eip155:84532' }] },
          }),
          { status: 500, headers: { 'x-trace-id': 'header' } },
        ),
    ),
  )
  const error = await client.getIntentOpStatus(1n).catch((error) => error)
  expect(error).toMatchObject({
    statusCode: 500,
    traceId: 'header',
    context: { traceId: 'header', candidateErrors: [{ chainId: 84532 }] },
  })
  expect(isRetryable(error)).toBe(true)
  expect(isAuthError(error)).toBe(false)
})
