import { describe, expect, test } from 'vitest'
import {
  InsufficientSponsorBalanceError,
  isInsufficientSponsorBalance,
  isSponsorError,
  isSponsorLimitExceeded,
  parseErrorEnvelope,
  SponsorLimitExceededError,
  UnprocessableContentError,
} from './errors'

describe('parseErrorEnvelope sponsor errors', () => {
  test('maps sponsor limit failures to a typed compatible error', () => {
    const error = parseErrorEnvelope(
      {
        code: 'UNPROCESSABLE_CONTENT',
        message: 'Sponsor coverage exceeds configured per-client limit',
        traceId: 'trace-sponsor-cap',
        details: [
          {
            message: 'Sponsor coverage exceeds configured per-client limit',
            context: {
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

    expect(error).toBeInstanceOf(SponsorLimitExceededError)
    expect(error).toBeInstanceOf(UnprocessableContentError)
    expect(error.code).toBe('UNPROCESSABLE_CONTENT')
    expect(error.statusCode).toBe(422)
    expect(error.traceId).toBe('trace-sponsor-cap')
    expect(isSponsorLimitExceeded(error)).toBe(true)
    expect(isSponsorError(error)).toBe(true)
    expect(isInsufficientSponsorBalance(error)).toBe(false)
    expect(error).toMatchObject({
      limitKey: 'perIntentUSD',
      capUsd: 2.5,
      coverageUsd: 3.1,
      sponsorAddress: '0x1111111111111111111111111111111111111111',
    })
    expect((error as SponsorLimitExceededError).details).toHaveLength(1)
  })

  test('accepts cap failures without a sponsor address', () => {
    const error = parseErrorEnvelope(
      {
        code: 'UNPROCESSABLE_CONTENT',
        message: 'All candidate plans exceed the sponsorship limit',
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
    )

    expect(error).toMatchObject({
      limitKey: 'gasPerIntentUSD',
      sponsorAddress: undefined,
    })
  })

  test('drops malformed sponsor limit context values', () => {
    const error = parseErrorEnvelope(
      {
        code: 'UNPROCESSABLE_CONTENT',
        message: 'exceeds limit',
        traceId: '',
        details: [
          {
            message: 'exceeds limit',
            context: {
              code: 'SPONSOR_LIMIT_EXCEEDED',
              limitKey: 'unknown',
              capUSD: Number.POSITIVE_INFINITY,
            },
          },
        ],
      },
      422,
    )

    expect(error).toMatchObject({
      limitKey: undefined,
      capUsd: undefined,
    })
  })

  test('maps insufficient sponsor balances to a typed compatible error', () => {
    const error = parseErrorEnvelope(
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

    expect(error).toBeInstanceOf(InsufficientSponsorBalanceError)
    expect(error).toBeInstanceOf(UnprocessableContentError)
    expect(error.code).toBe('UNPROCESSABLE_CONTENT')
    expect(isInsufficientSponsorBalance(error)).toBe(true)
    expect(isSponsorError(error)).toBe(true)
    expect(isSponsorLimitExceeded(error)).toBe(false)
    expect(error).toMatchObject({
      failedCategories: ['gas', 'bridgeFee'],
      sponsorAddress: '0x2222222222222222222222222222222222222222',
      remainingBalanceUsd: 0.5,
      totalSponsoredUsd: 4.2,
    })
  })

  test('falls back to the generic error for unrelated detail codes', () => {
    const error = parseErrorEnvelope(
      {
        code: 'UNPROCESSABLE_CONTENT',
        message: 'No viable route found',
        traceId: '',
        details: [
          {
            message: 'no route',
            context: { code: 'NO_PLAN_AVAILABLE' },
          },
        ],
      },
      422,
    )

    expect(error).toBeInstanceOf(UnprocessableContentError)
    expect(error.constructor).toBe(UnprocessableContentError)
    expect(isSponsorError(error)).toBe(false)
  })
})
