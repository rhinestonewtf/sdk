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

// v1 1.22.0's answer to every recorded alps response, context included (the
// trace id is checked separately). Must not change.
const EXPECTED_ALPS: Record<string, Record<string, unknown>> = {
  'quote-invalid-api-key': {
    ctor: 'InvalidApiKeyError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Invalid API key',
    context: {},
  },
  'status-invalid-api-key': {
    ctor: 'InvalidApiKeyError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Invalid API key',
    context: {},
  },
  'portfolio-invalid-api-key': {
    ctor: 'InvalidApiKeyError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Invalid API key',
    context: {},
  },
  'splits-invalid-api-key': {
    ctor: 'InvalidApiKeyError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Invalid API key',
    context: {},
  },
  'quote-invalid-jwt': {
    ctor: 'OrchestratorError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Invalid token',
    context: {},
  },
  'app-fees-invalid-jwt': {
    ctor: 'OrchestratorError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Invalid token',
    context: {},
  },
  'quote-unsupported-chain': {
    ctor: 'UnsupportedChainIdError',
    statusCode: 400,
    errorType: 'Bad Request',
    message: 'Unsupported chain id',
    context: { path: 'destinationChainId' },
  },
  'quote-unsupported-token': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'Token 0x1111111111111111111111111111111111111111 on chain 421614 is not a valid ERC-20 or is not supported',
    context: {
      chainId: 421614,
      tokenAddress: '0x1111111111111111111111111111111111111111',
      domain: 'preplanning',
      code: 'MISSING_TOKEN_METADATA',
    },
  },
  'quote-no-route': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'No viable route found for this intent. Requested settlement layer(s): CCTP. Reason: no route supports this token and chain combination.',
    context: {
      requestedSettlementLayers: ['CCTP'],
      resolvedLayers: [
        'INTENT_EXECUTOR',
        'SAME_CHAIN',
        'INTENT_EXECUTOR',
        'CCTP',
        'CCTP',
        'CCTP',
        'CCTP',
        'SAME_CHAIN',
        'SAME_CHAIN',
        'SAME_CHAIN',
      ],
      failureCodes: ['NO_ROUTE_SUPPORT'],
      strategyFailures: [
        {
          strategy: 'CctpPlanStrategy',
          code: 'NO_ROUTE_SUPPORT',
          message:
            'No settlement layer supports any route for the given tokens/chains',
          detail: { sourceChains: [84532], destinationChainId: 1 },
        },
        {
          strategy: 'CctpPlanStrategy',
          code: 'NO_ROUTE_SUPPORT',
          message:
            'No settlement layer supports any route for the given tokens/chains',
          detail: { sourceChains: [84532], destinationChainId: 1 },
        },
      ],
      domain: 'planning',
      code: 'NO_PLAN_AVAILABLE',
    },
  },
  'quote-multiple-max-out': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message: 'Multiple max-out requests not supported',
    context: { domain: 'preplanning', code: 'MULTIPLE_MAX_OUT' },
  },
  'quote-custom-deadline': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'options.customDeadline is only supported for tokenless (INTENT_EXECUTOR) intents; this route cannot honor the override',
    context: {
      destinationChainId: 421614,
      domain: 'strategy-gate',
      code: 'INVALID_CUSTOM_DEADLINE',
    },
  },
  'quote-settlement-layer-unsupported': {
    ctor: 'OrchestratorError',
    statusCode: 400,
    errorType: 'Bad Request',
    message:
      'Intent has a destination chain which does not support any of the requested settlement layers',
    context: {
      chainId: 421614,
      settlementChainId: 421614,
      selectedSettlementLayers: ['RELAY'],
      supportedSettlementLayers: ['ACROSS', 'ECO', 'CCTP'],
    },
  },
  'quote-settlement-layer-invalid': {
    ctor: 'OrchestratorError',
    statusCode: 400,
    errorType: 'Bad Request',
    message: 'Invalid input',
    context: { path: 'options.settlementLayers' },
  },
  'status-malformed-id': {
    ctor: 'OrchestratorError',
    statusCode: 400,
    errorType: 'Bad Request',
    message: 'Intent ID must be a valid number',
    context: { path: 'id' },
  },
  'splits-insufficient-liquidity': {
    ctor: 'InsufficientLiquidityError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'Insufficient liquidity to fill the requested amounts. Partial splits available.',
    context: {},
    availableIntents: [
      { '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d': 250075022506n },
    ],
    unfillable: {
      '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d': 9999749924977494n,
    },
  },
  'splits-unsupported-token': {
    ctor: 'TokenNotSupportedError',
    statusCode: 400,
    errorType: 'Bad Request',
    message:
      'Token 0x1111111111111111111111111111111111111111 is not supported on chain 421614',
    context: {
      tokenAddress: '0x1111111111111111111111111111111111111111',
      chainId: 421614,
    },
  },
  'splits-unsupported-chain': {
    ctor: 'OrchestratorError',
    statusCode: 400,
    errorType: 'Bad Request',
    message: 'Invalid CAIP-2 chain id (no chain carries this id): 17000',
    context: { path: 'body' },
  },
  'quote-insufficient-balance-same-chain': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'Insufficient balance on the destination chain to complete this transfer. The selected balance does not cover the requested amount plus the gas amount reserved for execution.',
    context: {
      destinationChainId: 84532,
      token: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
      tokenSymbol: 'USDC',
      requestedAmount: '10000000',
      availableAmount: '400000',
      gasReserve: '0',
      domain: 'planning',
      code: 'INSUFFICIENT_BALANCE',
    },
  },
  'quote-insufficient-balance-cross-chain': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message: 'Insufficient balance after exhausting all candidates',
    context: {
      remaining: '8087343',
      requestedAmount: '10000000',
      domain: 'planning',
      code: 'INSUFFICIENT_BALANCE',
    },
  },
  'quote-swap-inputs-rejected': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'Same-chain swap inputs rejected by quoter \u2014 see candidateErrors for per-input failure codes.',
    context: {
      destinationChainId: 84532,
      outputToken: '0x4200000000000000000000000000000000000006',
      outputTokenSymbol: 'WETH',
      candidateErrors: [
        {
          code: 'chain_not_available',
          chainId: 84532,
          fromToken: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
          toToken: '0x4200000000000000000000000000000000000006',
          amount: '10000000000000',
          direction: 'exactOut',
        },
      ],
      domain: 'preplanning',
      code: 'SWAP_INPUTS_REJECTED',
    },
  },
  'splits-insufficient-liquidity-empty': {
    ctor: 'InsufficientLiquidityError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'Insufficient liquidity to fill the requested amounts. Partial splits available.',
    context: {},
    availableIntents: [],
    unfillable: { '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d': 1000000n },
  },
  'quote-zero-balance': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message: 'No balances available',
    context: { domain: 'planning-gate', code: 'ZERO_BALANCE' },
  },
  'status-not-found': {
    ctor: 'OrchestratorError',
    statusCode: 404,
    errorType: 'Not Found',
    message: 'Intent operation 123 not found',
    context: {},
  },
  'app-fees-invalid-api-key': {
    ctor: 'InvalidApiKeyError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Invalid API key',
    context: {},
  },
  'quote-missing-credentials': {
    ctor: 'OrchestratorError',
    statusCode: 401,
    errorType: 'Unauthorized',
    message: 'Missing credentials',
    context: {},
  },
  'quote-malformed-json': {
    ctor: 'OrchestratorError',
    statusCode: 400,
    errorType: 'Bad Request',
    message:
      "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
    context: {},
  },
  'submit-refused-signature': {
    ctor: 'OrchestratorError',
    statusCode: 400,
    errorType: 'Bad Request',
    message: 'Simulation failed: InvalidSignature()',
    context: {
      category: 'INVALID_SIGNATURE',
      errorName: 'InvalidSignature()',
      errorSelector: '0x8baa579f',
      nonce:
        '404366854094919221366530100659967194795441885949701004272900622064981696',
      retryable: false,
      simulations: [
        {
          action: 'fill',
          call: {
            chainId: 84532,
            data: '0x8f5c35220000000000000000000000000000000000000000000000000000000000000020',
            to: '0x00000000005ad9ce1f5035fd62ca96cef16adaaf',
            value: '0',
          },
          chainId: 84532,
          details: {
            blockNumber: '58043514',
            relayer: '0xfeebabe17996b3346cf80f04a1f072102a90cf09',
            stateOverride: [
              {
                address: '0xfeebabe17996b3346cf80f04a1f072102a90cf09',
                balance:
                  '452312848583266388373324160190187140051835877600158453279131187530910662655',
              },
              {
                address: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
                stateDiff: [
                  {
                    slot: '0x9f8535ac308f61c0ae9f083a98d46f5a87b3bafd370b33f505dace0dd089df58',
                    value:
                      '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
                  },
                  {
                    slot: '0xdf26c24c3169c2057bbcf7c0f7bbb45b781afc1454c5272e547471da1536be8d',
                    value:
                      '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
                  },
                ],
              },
              {
                address: '0x4200000000000000000000000000000000000006',
                stateDiff: [
                  {
                    slot: '0x0d773c3ac064411fee2ad277309c84046b19359e373cfa82220cd6c9bf1bb67b',
                    value:
                      '0x000000000000000000000000000000000000000c9f2c9cd04674edea40000000',
                  },
                  {
                    slot: '0xa52ba8b9b33ca036b160dcbccfefc39723e8744123ad74c965aaec0ef260a767',
                    value:
                      '0x000000000000000000000000000000000000000c9f2c9cd04674edea40000000',
                  },
                ],
              },
              {
                address: '0x2f6fde5e2aeab6335d8f978b4d8b2a9c1129acfb',
                stateDiff: [
                  {
                    slot: '0xee7d080fc2c02618d6eeead98045aed8203eeb2ffb09a12ba973b766bfb11388',
                    value:
                      '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
                  },
                  {
                    slot: '0xc57409f2e98a301df4c2d74a9518a033013126b8c4f0bcff1e1ac75ca751c166',
                    value:
                      '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
                  },
                ],
              },
              {
                address: '0x9b9e21a3a7d8372457881b7a85eeff66c6dcb3a9',
                stateDiff: [
                  {
                    slot: '0xee7d080fc2c02618d6eeead98045aed8203eeb2ffb09a12ba973b766bfb11388',
                    value:
                      '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
                  },
                  {
                    slot: '0xc57409f2e98a301df4c2d74a9518a033013126b8c4f0bcff1e1ac75ca751c166',
                    value:
                      '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
                  },
                ],
              },
            ],
          },
          errorCategory: 'INVALID_SIGNATURE',
          errorName: 'InvalidSignature()',
          errorSelector: '0x8baa579f',
          success: false,
        },
      ],
    },
  },
  'rate-limited': {
    ctor: 'RateLimitedError',
    statusCode: 429,
    errorType: 'Too Many Requests',
    message: 'Too Many Requests',
    context: { retryAfter: '2' },
  },
  'relayer-market-unavailable': {
    ctor: 'ServiceUnavailableError',
    statusCode: 503,
    errorType: 'Service Unavailable',
    message: 'Service Unavailable',
    context: {},
  },
  'unhandled-internal-error': {
    ctor: 'OrchestratorError',
    statusCode: 500,
    errorType: 'Internal Server Error',
    message: 'Something went wrong',
    context: {},
  },
  'contract-call-failed': {
    ctor: 'OrchestratorError',
    statusCode: 500,
    errorType: 'Internal Server Error',
    message: 'Contract call failed',
    context: {
      details: 'execution reverted',
      contractAddress: '0x0000000000000000000000000000000000000001',
      functionName: 'balanceOf',
    },
  },
  'external-service-timeout': {
    ctor: 'OrchestratorError',
    statusCode: 504,
    errorType: 'Unknown',
    message: 'Relay quote timed out',
    context: {
      chainId: 8453,
      domain: 'bridge-api',
      code: 'RELAY_FAILED',
      kind: 'timeout',
    },
  },
  'key-scope-denied': {
    ctor: 'OrchestratorError',
    statusCode: 403,
    errorType: 'Forbidden',
    message:
      "API key scope 'allowMainnet' denies this request (required: true, actual: false)",
    context: { scope: 'allowMainnet', required: true, actual: false },
  },
  'quote-insufficient-liquidity': {
    ctor: 'OrchestratorError',
    statusCode: 422,
    errorType: 'Unprocessable Entity',
    message:
      'Insufficient liquidity to fill the requested amounts. Partial splits available.',
    context: {},
  },
}

// The only fields where blanc's answer differs from the alps one above. Every
// other field must be equal.
const BLANC_DIFFERS: Record<
  string,
  {
    reason: string
    field: 'message' | 'context'
    blanc: unknown
  }
> = {
  'quote-unsupported-chain': {
    reason:
      'Blanc rejects the unknown chain in chain-id validation, which names no field path.',
    field: 'context',
    blanc: {},
  },
  'quote-unsupported-token': {
    reason: "Blanc's message names the chain in CAIP-2 form.",
    field: 'message',
    blanc:
      'Token 0x1111111111111111111111111111111111111111 on chain eip155:421614 is not a valid ERC-20 or is not supported',
  },
  'splits-unsupported-chain': {
    reason: "Blanc's chain-id validator words the message differently.",
    field: 'message',
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
      expect(view).toEqual(EXPECTED_ALPS[envelope.id])
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

    test('blanc gives what alps gives, bar the listed differences', async () => {
      const alps = await capture(envelope.operation, envelope.alps)
      const blanc = await capture(envelope.operation, envelope.blanc)
      const differs = BLANC_DIFFERS[envelope.id]
      expect(blanc.view).toEqual({
        ...EXPECTED_ALPS[envelope.id],
        ...(differs && { [differs.field]: differs.blanc }),
      })
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
