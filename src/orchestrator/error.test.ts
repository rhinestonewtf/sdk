import { describe, expect, test } from 'vitest'
import {
  ForbiddenError,
  InsufficientSponsorBalanceError,
  isConnectionError,
  isInsufficientSponsorBalance,
  isRetryable,
  isSimulationFailed,
  isSponsorError,
  isSponsorLimitExceeded,
  KeyScopeDeniedError,
  parseErrorEnvelope,
  SimulationFailedError,
  SponsorLimitExceededError,
  UnprocessableContentError,
} from './error'

describe('parseErrorEnvelope — KEY_SCOPE_DENIED', () => {
  test('parses level-based scope denial', () => {
    const err = parseErrorEnvelope(
      {
        code: 'KEY_SCOPE_DENIED',
        message:
          "API key scope 'intents' denies this request (required: write, actual: read)",
        traceId: 'abc',
        details: [
          {
            message:
              "API key scope 'intents' denies this request (required: write, actual: read)",
            context: { scope: 'intents', required: 'write', actual: 'read' },
          },
        ],
      },
      403,
    )

    expect(err).toBeInstanceOf(KeyScopeDeniedError)
    expect(err).toBeInstanceOf(ForbiddenError)
    expect(err.code).toBe('KEY_SCOPE_DENIED')
    expect(err.statusCode).toBe(403)
    expect(err.traceId).toBe('abc')
    expect((err as KeyScopeDeniedError).scope).toBe('intents')
    expect((err as KeyScopeDeniedError).required).toBe('write')
    expect((err as KeyScopeDeniedError).actual).toBe('read')
  })

  test('parses boolean-based scope denial (allowMainnet)', () => {
    const err = parseErrorEnvelope(
      {
        code: 'KEY_SCOPE_DENIED',
        message:
          "API key scope 'allowMainnet' denies this request (required: true, actual: false)",
        traceId: '',
        details: [
          {
            message: '...',
            context: { scope: 'allowMainnet', required: true, actual: false },
          },
        ],
      },
      403,
    ) as KeyScopeDeniedError

    expect(err.scope).toBe('allowMainnet')
    expect(err.required).toBe(true)
    expect(err.actual).toBe(false)
  })

  test('falls back to empty fields when details are missing', () => {
    const err = parseErrorEnvelope(
      {
        code: 'KEY_SCOPE_DENIED',
        message: 'Forbidden',
        traceId: '',
      },
      403,
    ) as KeyScopeDeniedError

    expect(err).toBeInstanceOf(KeyScopeDeniedError)
    expect(err.scope).toBe('')
    expect(err.required).toBe('')
    expect(err.actual).toBe('')
  })
})

describe('parseErrorEnvelope — UNPROCESSABLE_CONTENT', () => {
  test('preserves structured details for callers', () => {
    const err = parseErrorEnvelope(
      {
        code: 'UNPROCESSABLE_CONTENT',
        message: 'No viable route found for this intent.',
        traceId: 'trace-unprocessable',
        details: [
          {
            message: 'No viable route found for this intent.',
            context: {
              code: 'NO_PLAN_AVAILABLE',
              failureCodes: ['NO_ROUTE_SUPPORT', 'RELAY_FAILED'],
              strategyFailures: [
                {
                  strategy: 'StandardPlanStrategy',
                  code: 'NO_ROUTE_SUPPORT',
                  message: 'no route support',
                },
                {
                  strategy: 'RelayPlanStrategy',
                  code: 'RELAY_FAILED',
                  message: 'Relay quote exceeded 3000ms deadline',
                },
              ],
            },
          },
        ],
      },
      422,
    )

    expect(err).toBeInstanceOf(UnprocessableContentError)
    expect(err.code).toBe('UNPROCESSABLE_CONTENT')
    expect(err.statusCode).toBe(422)
    expect(err.traceId).toBe('trace-unprocessable')
    expect((err as UnprocessableContentError).details).toEqual([
      {
        message: 'No viable route found for this intent.',
        context: {
          code: 'NO_PLAN_AVAILABLE',
          failureCodes: ['NO_ROUTE_SUPPORT', 'RELAY_FAILED'],
          strategyFailures: [
            {
              strategy: 'StandardPlanStrategy',
              code: 'NO_ROUTE_SUPPORT',
              message: 'no route support',
            },
            {
              strategy: 'RelayPlanStrategy',
              code: 'RELAY_FAILED',
              message: 'Relay quote exceeded 3000ms deadline',
            },
          ],
        },
      },
    ])
  })

  test('defaults details to an empty array when missing or malformed', () => {
    const withoutDetails = parseErrorEnvelope(
      {
        code: 'UNPROCESSABLE_CONTENT',
        message: 'unprocessable',
        traceId: '',
      },
      422,
    ) as UnprocessableContentError

    const malformedDetails = parseErrorEnvelope(
      {
        code: 'UNPROCESSABLE_CONTENT',
        message: 'unprocessable',
        traceId: '',
        details: [
          { context: { code: 'NO_PLAN_AVAILABLE' } },
          { message: 123, context: { code: 'NO_PLAN_AVAILABLE' } },
          'not-an-object',
        ],
      },
      422,
    ) as UnprocessableContentError

    expect(withoutDetails.details).toEqual([])
    expect(malformedDetails.details).toEqual([])
  })
})

describe('parseErrorEnvelope — sponsor errors', () => {
  test('maps SPONSOR_LIMIT_EXCEEDED to a typed error with structured fields', () => {
    const err = parseErrorEnvelope(
      {
        code: 'UNPROCESSABLE_CONTENT',
        message: 'Sponsor coverage exceeds configured per-client limit',
        traceId: 'trace-sponsor-cap',
        details: [
          {
            message: 'Sponsor coverage exceeds configured per-client limit',
            context: {
              domain: 'planning',
              code: 'SPONSOR_LIMIT_EXCEEDED',
              limitKey: 'perIntentUSD',
              capUSD: 2.5,
              coverageUSD: 3.1,
              sponsorAddress: '0x1111111111111111111111111111111111111111',
            },
          },
        ],
      },
      422,
    )

    expect(err).toBeInstanceOf(SponsorLimitExceededError)
    // Backward-compatible: still catchable as unprocessable content.
    expect(err).toBeInstanceOf(UnprocessableContentError)
    expect(err.code).toBe('UNPROCESSABLE_CONTENT')
    expect(err.statusCode).toBe(422)
    expect(err.traceId).toBe('trace-sponsor-cap')
    expect(isSponsorLimitExceeded(err)).toBe(true)
    expect(isSponsorError(err)).toBe(true)
    expect(isInsufficientSponsorBalance(err)).toBe(false)

    const cap = err as SponsorLimitExceededError
    expect(cap.limitKey).toBe('perIntentUSD')
    expect(cap.capUsd).toBe(2.5)
    expect(cap.coverageUsd).toBe(3.1)
    expect(cap.sponsorAddress).toBe(
      '0x1111111111111111111111111111111111111111',
    )
    // Raw details are still preserved.
    expect(cap.details).toHaveLength(1)
  })

  test('handles the post-fold cap breach with no sponsorAddress', () => {
    const err = parseErrorEnvelope(
      {
        code: 'UNPROCESSABLE_CONTENT',
        message: 'All candidate plans exceed the per-client sponsorship limit',
        traceId: '',
        details: [
          {
            message: 'exceeds limit',
            context: {
              code: 'SPONSOR_LIMIT_EXCEEDED',
              limitKey: 'gasPerIntentUSD',
              capUSD: 1,
              coverageUSD: 2,
            },
          },
        ],
      },
      422,
    ) as SponsorLimitExceededError

    expect(isSponsorLimitExceeded(err)).toBe(true)
    expect(err.limitKey).toBe('gasPerIntentUSD')
    expect(err.sponsorAddress).toBeUndefined()
  })

  test('drops an unrecognized limitKey rather than trusting it', () => {
    const err = parseErrorEnvelope(
      {
        code: 'UNPROCESSABLE_CONTENT',
        message: 'exceeds limit',
        traceId: '',
        details: [
          {
            message: 'exceeds limit',
            context: { code: 'SPONSOR_LIMIT_EXCEEDED', limitKey: 'bogusKey' },
          },
        ],
      },
      422,
    ) as SponsorLimitExceededError

    expect(isSponsorLimitExceeded(err)).toBe(true)
    expect(err.limitKey).toBeUndefined()
    expect(err.capUsd).toBeUndefined()
  })

  test('maps INSUFFICIENT_SPONSOR_BALANCE to a typed error', () => {
    const err = parseErrorEnvelope(
      {
        code: 'UNPROCESSABLE_CONTENT',
        message: 'Insufficient sponsor balance to cover sponsored fees',
        traceId: 'trace-sponsor-balance',
        details: [
          {
            message: 'Insufficient sponsor balance to cover sponsored fees',
            context: {
              code: 'INSUFFICIENT_SPONSOR_BALANCE',
              failedCategories: ['gas', 'bridgeFee'],
              sponsorAddress: '0x2222222222222222222222222222222222222222',
              remainingBalanceUSD: 0.5,
              totalSponsoredUSD: 4.2,
            },
          },
        ],
      },
      422,
    )

    expect(err).toBeInstanceOf(InsufficientSponsorBalanceError)
    expect(err).toBeInstanceOf(UnprocessableContentError)
    expect(err.code).toBe('UNPROCESSABLE_CONTENT')
    expect(isInsufficientSponsorBalance(err)).toBe(true)
    expect(isSponsorError(err)).toBe(true)
    expect(isSponsorLimitExceeded(err)).toBe(false)

    const balance = err as InsufficientSponsorBalanceError
    expect(balance.failedCategories).toEqual(['gas', 'bridgeFee'])
    expect(balance.sponsorAddress).toBe(
      '0x2222222222222222222222222222222222222222',
    )
    expect(balance.remainingBalanceUsd).toBe(0.5)
    expect(balance.totalSponsoredUsd).toBe(4.2)
  })

  test('falls back to a generic UnprocessableContentError for non-sponsor codes', () => {
    const err = parseErrorEnvelope(
      {
        code: 'UNPROCESSABLE_CONTENT',
        message: 'No viable route found for this intent.',
        traceId: '',
        details: [
          { message: 'no route', context: { code: 'NO_PLAN_AVAILABLE' } },
        ],
      },
      422,
    )

    expect(err).toBeInstanceOf(UnprocessableContentError)
    expect(isSponsorError(err)).toBe(false)
    expect(err.constructor.name).toBe('UnprocessableContentError')
  })
})

describe('parseErrorEnvelope — SIMULATION_FAILED', () => {
  test('parses retryable re-prepare simulation failures', () => {
    const err = parseErrorEnvelope(
      {
        code: 'SIMULATION_FAILED',
        message: 'Quote expired before submission',
        traceId: 'trace-1',
        details: {
          nonce:
            '9264294129415427553211071916923423671025140431735532255800441766430106316',
          category: 'QUOTE_EXPIRED',
          errorSelector: '0xcd21db4f',
          errorName: 'SignatureExpired(uint256)',
          errorArgs: { deadline: '1' },
          retryable: true,
          retryHint: 'RE_PREPARE',
        },
      },
      409,
    )

    expect(err).toBeInstanceOf(SimulationFailedError)
    expect(isSimulationFailed(err)).toBe(true)
    expect(err.code).toBe('SIMULATION_FAILED')
    expect(err.statusCode).toBe(409)
    expect((err as SimulationFailedError).nonce).toBe(
      '9264294129415427553211071916923423671025140431735532255800441766430106316',
    )
    expect((err as SimulationFailedError).category).toBe('QUOTE_EXPIRED')
    expect((err as SimulationFailedError).errorSelector).toBe('0xcd21db4f')
    expect((err as SimulationFailedError).errorName).toBe(
      'SignatureExpired(uint256)',
    )
    expect((err as SimulationFailedError).errorArgs).toEqual({ deadline: '1' })
    expect((err as SimulationFailedError).retryable).toBe(true)
    expect((err as SimulationFailedError).retryHint).toBe('RE_PREPARE')
    expect(isRetryable(err)).toBe(true)
  })

  test('preserves failed simulation entries for non-retryable failures', () => {
    const err = parseErrorEnvelope(
      {
        code: 'SIMULATION_FAILED',
        message: 'Simulation failed: EmptyRevert',
        traceId: 'trace-2',
        details: {
          category: 'EMPTY_REVERT',
          errorSelector: '0x',
          errorName: 'EmptyRevert',
          retryable: false,
          simulations: [
            {
              success: false,
              action: 'fill',
              chainId: 'eip155:8453',
              call: { to: '0xbf9b5b917a83f8adac17b0752846d41d8d7b7e17' },
              errorSelector: '0x',
              errorName: 'EmptyRevert',
              errorCategory: 'EMPTY_REVERT',
              details: {
                simulationUrls: [
                  'https://www.tdly.co/shared/simulation/c6b8aede-ad45-4ce6-be85-cf51da261546',
                ],
              },
            },
          ],
        },
      },
      400,
    )

    expect(isSimulationFailed(err)).toBe(true)
    expect((err as SimulationFailedError).retryable).toBe(false)
    expect((err as SimulationFailedError).simulations).toHaveLength(1)
    expect((err as SimulationFailedError).simulations[0]?.action).toBe('fill')
    expect((err as SimulationFailedError).simulations[0]?.details).toEqual({
      simulationUrls: [
        'https://www.tdly.co/shared/simulation/c6b8aede-ad45-4ce6-be85-cf51da261546',
      ],
    })
    expect(isRetryable(err)).toBe(false)
  })

  test('does not treat retry hints as retryable without retryable=true', () => {
    const err = parseErrorEnvelope(
      {
        code: 'SIMULATION_FAILED',
        message: 'Simulation failed: Router paused',
        traceId: 'trace-3',
        details: {
          category: 'ROUTER_PAUSED',
          errorSelector: '0x9e87fac8',
          errorName: 'Paused()',
          retryable: false,
          retryHint: 'RETRY_LATER',
        },
      },
      503,
    )

    expect(isSimulationFailed(err)).toBe(true)
    expect((err as SimulationFailedError).retryHint).toBe('RETRY_LATER')
    expect(isRetryable(err)).toBe(false)
  })
})

describe('isConnectionError', () => {
  test('matches Bun socket-closed message (plain Error)', () => {
    const err = new Error(
      'The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()',
    )
    expect(isConnectionError(err)).toBe(true)
  })

  test('matches undici TypeError via message + coded cause', () => {
    const err = new TypeError('fetch failed', {
      cause: Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
      }),
    })
    expect(isConnectionError(err)).toBe(true)
  })

  test('matches browser network-failure messages', () => {
    expect(isConnectionError(new TypeError('Failed to fetch'))).toBe(true)
    expect(
      isConnectionError(
        new TypeError('NetworkError when attempting to fetch resource.'),
      ),
    ).toBe(true)
  })

  test('does not retry non-network TypeErrors (logic bugs, bad URLs)', () => {
    // waitForExecution catches the whole getIntent path; these must propagate.
    expect(
      isConnectionError(
        new TypeError("Cannot read properties of undefined (reading 'status')"),
      ),
    ).toBe(false)
    expect(
      isConnectionError(new TypeError('Failed to parse URL from /intents/123')),
    ).toBe(false)
  })

  test('matches a top-level system error code', () => {
    const err = Object.assign(new Error('connect ETIMEDOUT'), {
      code: 'ETIMEDOUT',
    })
    expect(isConnectionError(err)).toBe(true)
  })

  test('matches an undici cause code nested in the chain', () => {
    const err = new Error('request failed', {
      cause: Object.assign(new Error('other side closed'), {
        code: 'UND_ERR_SOCKET',
      }),
    })
    expect(isConnectionError(err)).toBe(true)
  })

  test('does not match caller-initiated aborts', () => {
    const err = new Error('This operation was aborted')
    err.name = 'AbortError'
    expect(isConnectionError(err)).toBe(false)
  })

  test('does not match typed HTTP errors (handled by isRetryable)', () => {
    const err = parseErrorEnvelope(
      { code: 'INTERNAL_ERROR', message: 'boom', traceId: '' },
      500,
    )
    expect(isConnectionError(err)).toBe(false)
    expect(isRetryable(err)).toBe(true)
  })

  test('does not match unrelated logic errors', () => {
    expect(isConnectionError(new Error('intent not found'))).toBe(false)
    expect(isConnectionError(new RangeError('out of range'))).toBe(false)
    expect(isConnectionError(undefined)).toBe(false)
  })
})
