import { describe, expect, test } from 'vitest'
import {
  ForbiddenError,
  KeyScopeDeniedError,
  parseErrorEnvelope,
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
