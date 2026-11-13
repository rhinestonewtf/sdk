import { afterEach, describe, expect, test, vi } from 'vitest'
import envelopes from './__fixtures__/error-envelopes.json'
import { Orchestrator } from './client'
import {
  InsufficientLiquidityError,
  isAuthError,
  isRateLimited,
  isRetryable,
  isValidationError,
} from './error'

// Real alps and blanc error responses recorded from the prod orchestrator
// (plus a few derived from its error handler), replayed through the client.

interface RecordedResponse {
  status: number
  traceId: string | null
  retryAfter?: string
  body: unknown
}

interface EnvelopeCase {
  id: string
  operation: string
  source: string
  alps: RecordedResponse
  blanc: RecordedResponse
}

const CASES = envelopes as EnvelopeCase[]

const authProvider = {
  getHeaders: async () => ({}),
  getSubmitHeaders: async () => ({}),
}

function toResponse(recorded: RecordedResponse): Response {
  const body = recorded.body as { __text?: string }
  const text =
    typeof body?.__text === 'string' ? body.__text : JSON.stringify(body)
  const headers: Record<string, string> = {}
  if (recorded.traceId) headers['x-trace-id'] = recorded.traceId
  if (recorded.retryAfter) headers['retry-after'] = recorded.retryAfter
  return new Response(text, { status: recorded.status, headers })
}

function call(orchestrator: Orchestrator, operation: string): Promise<unknown> {
  switch (operation) {
    case 'quote':
      return orchestrator.getIntentRoute({} as any)
    case 'submit':
      return orchestrator.submitIntent({} as any, false)
    case 'status':
      return orchestrator.getIntentOpStatus(1n)
    case 'portfolio':
      return orchestrator.getPortfolio(
        '0x0000000000000000000000000000000000000001',
      )
    case 'splits':
      return orchestrator.splitIntents({
        chain: { id: 421614 } as any,
        tokens: {},
      })
    case 'appFees':
      return orchestrator.getAppFeeBalances()
    default:
      throw new Error(`unknown operation ${operation}`)
  }
}

async function capture(operation: string, recorded: RecordedResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => toResponse(recorded)),
  )
  const orchestrator = new Orchestrator('https://example.test', authProvider)
  const error: any = await call(orchestrator, operation).then(
    () => {
      throw new Error('expected the call to throw')
    },
    (e) => e,
  )
  const { traceId: contextTraceId, ...context } = error.context ?? {}
  return {
    error,
    view: {
      ctor: error.constructor.name,
      statusCode: error.statusCode,
      errorType: error.errorType,
      message: error.message,
      context,
      availableIntents: error.availableIntents,
      unfillable: error.unfillable,
    },
    traceId: error.traceId as string,
    contextTraceId: contextTraceId as string | undefined,
  }
}

// v1 1.22.0's classification of every recorded alps response. Must not change.
const EXPECTED_ALPS: Record<
  string,
  { ctor: string; statusCode: number; errorType: string; message: string }
> = {
  'quote-invalid-api-key': {
    ctor: 'InvalidApiKeyError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Invalid API key',
  },
  'status-invalid-api-key': {
    ctor: 'InvalidApiKeyError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Invalid API key',
  },
  'portfolio-invalid-api-key': {
    ctor: 'InvalidApiKeyError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Invalid API key',
  },
  'splits-invalid-api-key': {
    ctor: 'InvalidApiKeyError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Invalid API key',
  },
  'quote-invalid-jwt': {
    ctor: 'OrchestratorError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Invalid token',
  },
  'app-fees-invalid-jwt': {
    ctor: 'OrchestratorError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Invalid token',
  },
  'quote-unsupported-chain': {
    ctor: 'UnsupportedChainIdError',
    statusCode: 400,
    errorType: 'Bad Request',
    message: 'Unsupported chain id',
  },
  'quote-unsupported-token': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'Token 0x1111111111111111111111111111111111111111 on chain 421614 is not a valid ERC-20 or is not supported',
  },
  'quote-no-route': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'No viable route found for this intent. Requested settlement layer(s): CCTP. Reason: no route supports this token and chain combination.',
  },
  'quote-multiple-max-out': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message: 'Multiple max-out requests not supported',
  },
  'quote-custom-deadline': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'options.customDeadline is only supported for tokenless (INTENT_EXECUTOR) intents; this route cannot honor the override',
  },
  'quote-settlement-layer-unsupported': {
    ctor: 'OrchestratorError',
    statusCode: 400,
    errorType: 'Bad Request',
    message:
      'Intent has a destination chain which does not support any of the requested settlement layers',
  },
  'quote-settlement-layer-invalid': {
    ctor: 'OrchestratorError',
    statusCode: 400,
    errorType: 'Bad Request',
    message: 'Invalid input',
  },
  'status-malformed-id': {
    ctor: 'OrchestratorError',
    statusCode: 400,
    errorType: 'Bad Request',
    message: 'Intent ID must be a valid number',
  },
  'splits-insufficient-liquidity': {
    ctor: 'InsufficientLiquidityError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'Insufficient liquidity to fill the requested amounts. Partial splits available.',
  },
  'splits-unsupported-token': {
    ctor: 'TokenNotSupportedError',
    statusCode: 400,
    errorType: 'Bad Request',
    message:
      'Token 0x1111111111111111111111111111111111111111 is not supported on chain 421614',
  },
  'splits-unsupported-chain': {
    ctor: 'OrchestratorError',
    statusCode: 400,
    errorType: 'Bad Request',
    message: 'Invalid CAIP-2 chain id (no chain carries this id): 17000',
  },
  'quote-insufficient-balance-same-chain': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'Insufficient balance on the destination chain to complete this transfer. The selected balance does not cover the requested amount plus the gas amount reserved for execution.',
  },
  'quote-insufficient-balance-cross-chain': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message: 'Insufficient balance after exhausting all candidates',
  },
  'quote-swap-inputs-rejected': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'Same-chain swap inputs rejected by quoter — see candidateErrors for per-input failure codes.',
  },
  'splits-insufficient-liquidity-empty': {
    ctor: 'InsufficientLiquidityError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'Insufficient liquidity to fill the requested amounts. Partial splits available.',
  },
  'quote-zero-balance': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message: 'No balances available',
  },
  'status-not-found': {
    ctor: 'OrchestratorError',
    statusCode: 404,
    errorType: 'Not Found',
    message: 'Intent operation 123 not found',
  },
  'app-fees-invalid-api-key': {
    ctor: 'InvalidApiKeyError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Invalid API key',
  },
  'quote-missing-credentials': {
    ctor: 'OrchestratorError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Missing credentials',
  },
  'quote-malformed-json': {
    ctor: 'OrchestratorError',
    statusCode: 400,
    errorType: 'Bad Request',
    message:
      "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
  },
  'submit-refused-signature': {
    ctor: 'OrchestratorError',
    statusCode: 400,
    errorType: 'Bad Request',
    message: 'Simulation failed: InvalidSignature()',
  },
  'rate-limited': {
    ctor: 'RateLimitedError',
    statusCode: 429,
    errorType: 'Too Many Requests',
    message: 'Too Many Requests',
  },
  'relayer-market-unavailable': {
    ctor: 'ServiceUnavailableError',
    statusCode: 503,
    errorType: 'Service Unavailable',
    message: 'Service Unavailable',
  },
  'unhandled-internal-error': {
    ctor: 'OrchestratorError',
    statusCode: 500,
    errorType: 'Internal Server Error',
    message: 'Something went wrong',
  },
  'contract-call-failed': {
    ctor: 'OrchestratorError',
    statusCode: 500,
    errorType: 'Internal Server Error',
    message: 'Contract call failed',
  },
  'external-service-timeout': {
    ctor: 'OrchestratorError',
    statusCode: 504,
    errorType: 'Unknown',
    message: 'Relay quote timed out',
  },
  'key-scope-denied': {
    ctor: 'OrchestratorError',
    statusCode: 403,
    errorType: 'Forbidden',
    message:
      "API key scope 'allowMainnet' denies this request (required: true, actual: false)",
  },
  'quote-insufficient-liquidity': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'Insufficient liquidity to fill the requested amounts. Partial splits available.',
  },
}

// The only fields where blanc's answer differs from alps's, with both values
// pinned. Every other field must be equal.
const BLANC_DIFFERS: Record<
  string,
  {
    reason: string
    field: 'message' | 'context'
    alps: unknown
    blanc: unknown
  }
> = {
  'quote-unsupported-chain': {
    reason:
      'Blanc rejects the unknown chain in chain-id validation, which names no field path.',
    field: 'context',
    alps: { path: 'destinationChainId' },
    blanc: {},
  },
  'quote-unsupported-token': {
    reason: "Blanc's message names the chain in CAIP-2 form.",
    field: 'message',
    alps: 'Token 0x1111111111111111111111111111111111111111 on chain 421614 is not a valid ERC-20 or is not supported',
    blanc:
      'Token 0x1111111111111111111111111111111111111111 on chain eip155:421614 is not a valid ERC-20 or is not supported',
  },
  'splits-unsupported-chain': {
    reason: "Blanc's chain-id validator words the message differently.",
    field: 'message',
    alps: 'Invalid CAIP-2 chain id (no chain carries this id): 17000',
    blanc: 'Invalid CAIP-2 chain id (unknown eip155 reference): "eip155:17000"',
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recorded orchestrator error envelopes', () => {
  test('every recorded case has an alps expectation', () => {
    expect(Object.keys(EXPECTED_ALPS).sort()).toEqual(
      CASES.map((c) => c.id).sort(),
    )
  })

  describe.each(CASES)('$id', (envelope) => {
    test('alps classification is unchanged', async () => {
      const { view } = await capture(envelope.operation, envelope.alps)
      expect({
        ctor: view.ctor,
        statusCode: view.statusCode,
        errorType: view.errorType,
        message: view.message,
      }).toEqual(EXPECTED_ALPS[envelope.id])
    })

    test.each(['alps', 'blanc'] as const)(
      '%s trace id comes from the x-trace-id header',
      async (side) => {
        const recorded = envelope[side]
        const { error, traceId, contextTraceId } = await capture(
          envelope.operation,
          recorded,
        )
        expect(traceId).toBe(recorded.traceId ?? '')
        // InsufficientLiquidityError carries no server context.
        if (!(error instanceof InsufficientLiquidityError)) {
          expect(contextTraceId).toBe(recorded.traceId ?? undefined)
        }
      },
    )

    test('blanc gives what alps gives', async () => {
      const alps = await capture(envelope.operation, envelope.alps)
      const blanc = await capture(envelope.operation, envelope.blanc)
      const differs = BLANC_DIFFERS[envelope.id]
      if (differs) {
        expect(alps.view[differs.field]).toEqual(differs.alps)
        expect(blanc.view[differs.field]).toEqual(differs.blanc)
        expect({ ...blanc.view, [differs.field]: null }).toEqual({
          ...alps.view,
          [differs.field]: null,
        })
      } else {
        expect(blanc.view).toEqual(alps.view)
      }
      for (const helper of [
        isRateLimited,
        isRetryable,
        isValidationError,
        isAuthError,
      ]) {
        expect(helper(blanc.error)).toBe(helper(alps.error))
      }
    })

    test('alps helpers keep their answers', async () => {
      const { error } = await capture(envelope.operation, envelope.alps)
      const status = EXPECTED_ALPS[envelope.id].statusCode
      expect(isRateLimited(error)).toBe(status === 429)
      expect(isRetryable(error)).toBe(status === 500 || status === 503)
      expect(isValidationError(error)).toBe(status === 400 || status === 422)
      expect(isAuthError(error)).toBe(status === 401)
    })
  })
})
