import { describe, expect, test } from 'vitest'
import {
  ForbiddenError,
  isRetryable,
  isSimulationFailed,
  KeyScopeDeniedError,
  parseErrorEnvelope,
  SimulationFailedError,
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
})
