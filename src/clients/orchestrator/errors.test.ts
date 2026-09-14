import { describe, expect, test } from 'vitest'
import {
  ConflictError,
  InsufficientSponsorBalanceError,
  isInsufficientSponsorBalance,
  isSolanaAccountNotCreated,
  isSponsorError,
  isSponsorLimitExceeded,
  parseErrorEnvelope,
  SolanaAccountNotCreatedError,
  SponsorLimitExceededError,
  UnprocessableContentError,
  ValidationError,
} from './errors'

describe('parseErrorEnvelope Solana account errors', () => {
  test('maps structured missing-account details and preserves validation metadata', () => {
    const error = parseErrorEnvelope(
      {
        code: 'VALIDATION_ERROR',
        message: 'No Swig at SwigAddress1 for this account yet',
        traceId: 'trace-solana-account',
        details: [
          {
            message: 'No Swig at SwigAddress1 for this account yet',
            context: {
              domain: 'planning',
              code: 'SOLANA_ACCOUNT_NOT_CREATED',
              swigAddress: 'SwigAddress1',
              chainId: 792703810,
            },
          },
        ],
      },
      400,
    )

    expect(error).toBeInstanceOf(SolanaAccountNotCreatedError)
    expect(error).toBeInstanceOf(ValidationError)
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.statusCode).toBe(400)
    expect(error.traceId).toBe('trace-solana-account')
    expect(isSolanaAccountNotCreated(error)).toBe(true)
    expect(error).toMatchObject({
      swigAddress: 'SwigAddress1',
      chainId: 792703810,
      issues: [
        {
          context: {
            domain: 'planning',
            code: 'SOLANA_ACCOUNT_NOT_CREATED',
            swigAddress: 'SwigAddress1',
            chainId: 792703810,
          },
        },
      ],
    })
  })

  test('maps the CAIP-2 chain id the live error boundary returns', () => {
    const error = parseErrorEnvelope(
      {
        code: 'VALIDATION_ERROR',
        message: 'No Swig at SwigAddress1 for this account yet',
        traceId: 'trace-solana-caip2',
        details: [
          {
            message: 'No Swig at SwigAddress1 for this account yet',
            context: {
              domain: 'planning',
              code: 'SOLANA_ACCOUNT_NOT_CREATED',
              swigAddress: 'SwigAddress1',
              chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
            },
          },
        ],
      },
      400,
    )

    expect(isSolanaAccountNotCreated(error)).toBe(true)
    expect(error).toMatchObject({
      swigAddress: 'SwigAddress1',
      chainId: 792703810,
    })
  })

  test.each([
    ['792703810'],
    ['solana:UnknownClusterGenesisHash11111111'],
    [-1],
    [1.5],
    [null],
  ])('recognizes the error but drops an unusable chain id %p', (chainId) => {
    const context = {
      code: 'SOLANA_ACCOUNT_NOT_CREATED',
      swigAddress: 'SwigAddress1',
      chainId,
    }
    const error = parseErrorEnvelope(
      {
        code: 'VALIDATION_ERROR',
        message: 'No Swig at SwigAddress1 for this account yet',
        traceId: 'trace-solana-chain',
        details: [{ message: 'no swig', context }],
      },
      400,
    )

    expect(isSolanaAccountNotCreated(error)).toBe(true)
    expect(error).toMatchObject({ swigAddress: 'SwigAddress1' })
    expect((error as SolanaAccountNotCreatedError).chainId).toBeUndefined()
    expect((error as SolanaAccountNotCreatedError).issues[0]?.context).toEqual(
      context,
    )
  })

  test.each([
    [{ code: 'SOLANA_ACCOUNT_NOT_CREATED' }],
    [{ code: 'SOLANA_ACCOUNT_NOT_CREATED', swigAddress: '' }],
  ])('keeps details without a Swig address generic', (context) => {
    const error = parseErrorEnvelope(
      {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        traceId: 'trace-generic',
        details: [{ message: 'Invalid request', context }],
      },
      400,
    )

    expect(error.constructor).toBe(ValidationError)
    expect(isSolanaAccountNotCreated(error)).toBe(false)
    expect((error as ValidationError).issues[0]?.context).toEqual(context)
  })
})

describe('parseErrorEnvelope signature context', () => {
  test.each(['SIGNATURE_EXPIRED', 'SIGNATURE_INVALID'])(
    'preserves %s validation context',
    (code) => {
      const error = parseErrorEnvelope(
        {
          code: 'VALIDATION_ERROR',
          message: 'Re-quote and sign again.',
          traceId: 'trace-signature',
          details: [{ message: 'signature refused', context: { code } }],
        },
        400,
      )

      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).issues).toEqual([
        { message: 'signature refused', context: { code } },
      ])
    },
  )

  test('preserves SIGNATURE_REUSED conflict context and outer metadata', () => {
    const error = parseErrorEnvelope(
      {
        code: 'CONFLICT',
        message: 'Re-quote and sign again.',
        traceId: 'trace-reused',
        details: [
          {
            message: 'Replay counter already spent',
            context: { code: 'SIGNATURE_REUSED', counter: '7' },
          },
        ],
      },
      409,
    )

    expect(error).toBeInstanceOf(ConflictError)
    expect(error).toMatchObject({
      code: 'CONFLICT',
      statusCode: 409,
      traceId: 'trace-reused',
      details: [
        {
          context: { code: 'SIGNATURE_REUSED', counter: '7' },
        },
      ],
    })
  })
})

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
