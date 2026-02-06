import { describe, expect, test } from 'vitest'
import { errAsync, okAsync } from 'neverthrow'
import {
  categorizeError,
  ErrorCategory,
  type CategorizedError,
  type OrchestratorResult,
} from './safeClient'
import {
  AuthenticationRequiredError,
  BadRequestError,
  ForbiddenError,
  InsufficientBalanceError,
  InsufficientLiquidityError,
  InternalServerError,
  InvalidApiKeyError,
  NoPathFoundError,
  OrchestratorError,
  RateLimitedError,
  ServiceUnavailableError,
  UnsupportedChainError,
  UnsupportedTokenError,
} from './error'
import type { Portfolio } from './types'

/**
 * Helper for exhaustive checks - TypeScript will error if a case is missed.
 */
function assertNever(x: never): never {
  throw new Error(`Unexpected case: ${x}`)
}

/**
 * Example error handler using exhaustive pattern matching.
 * TypeScript ensures all categories are handled.
 */
function handlePortfolioError(categorized: CategorizedError): string {
  switch (categorized.category) {
    case ErrorCategory.Auth:
      return `Authentication failed: ${categorized.error.message}. Please check your API key.`

    case ErrorCategory.Balance:
      if (categorized.error instanceof InsufficientLiquidityError) {
        const available = categorized.error.availableIntents
          .map(intent => Object.entries(intent).map(([k, v]) => `${k}: ${v.toString()}`).join(', '))
          .join('; ')
        return `Insufficient liquidity. Available: [${available}]`
      }
      return `Insufficient balance: ${categorized.error.message}`

    case ErrorCategory.Validation:
      return `Invalid request: ${categorized.error.message}`

    case ErrorCategory.Server:
      return `Server error: ${categorized.error.message}. Please try again later.`

    case ErrorCategory.RateLimit:
      const retryMsg = categorized.retryAfter
        ? ` Retry after ${categorized.retryAfter}s.`
        : ''
      return `Rate limited.${retryMsg}`

    case ErrorCategory.Unknown:
      return `Unexpected error: ${categorized.error.message}`

    default:
      // TypeScript will error here if we miss a case
      return assertNever(categorized)
  }
}

describe('SafeOrchestrator', () => {
  describe('Result pattern with exhaustive error handling', () => {
    test('handles successful portfolio fetch', async () => {
      const mockPortfolio: Portfolio = [
        {
          symbol: 'ETH',
          decimals: 18,
          balances: { locked: 0n, unlocked: 1000000000000000000n },
          chains: [
            {
              chain: 1,
              address: '0x0000000000000000000000000000000000000000',
              locked: 0n,
              unlocked: 1000000000000000000n,
            },
          ],
        },
      ]

      // Simulate a successful result
      const result: OrchestratorResult<Portfolio> = okAsync(mockPortfolio)

      // Pattern: match on result
      const output = await result.match(
        (portfolio) => `Found ${portfolio.length} tokens`,
        (error) => handlePortfolioError(categorizeError(error)),
      )

      expect(output).toBe('Found 1 tokens')
    })

    test('handles InsufficientBalanceError with exhaustive check', async () => {
      const error = new InsufficientBalanceError({
        traceId: 'trace-123',
        statusCode: 400,
      })

      const result: OrchestratorResult<Portfolio> = errAsync(error)

      const output = await result.match(
        (portfolio) => `Found ${portfolio.length} tokens`,
        (error) => handlePortfolioError(categorizeError(error)),
      )

      expect(output).toBe('Insufficient balance: Insufficient balance')
    })

    test('handles AuthenticationRequiredError', async () => {
      const error = new AuthenticationRequiredError({
        traceId: 'trace-456',
        statusCode: 401,
      })

      const result: OrchestratorResult<Portfolio> = errAsync(error)

      const output = await result.match(
        () => 'success',
        (error) => handlePortfolioError(categorizeError(error)),
      )

      expect(output).toContain('Authentication failed')
      expect(output).toContain('Please check your API key')
    })

    test('handles RateLimitedError with retry-after', async () => {
      const error = new RateLimitedError({
        context: { retryAfter: '30' },
        traceId: 'trace-789',
        statusCode: 429,
      })

      const result: OrchestratorResult<Portfolio> = errAsync(error)

      const output = await result.match(
        () => 'success',
        (error) => handlePortfolioError(categorizeError(error)),
      )

      expect(output).toBe('Rate limited. Retry after 30s.')
    })

    test('handles InsufficientLiquidityError with partial data', async () => {
      const error = new InsufficientLiquidityError({
        availableIntents: [{ '0xtoken': 500n }],
        unfillable: { '0xtoken': 500n },
        traceId: 'trace-liquidity',
        statusCode: 422,
      })

      const result: OrchestratorResult<Portfolio> = errAsync(error)

      const output = await result.match(
        () => 'success',
        (error) => handlePortfolioError(categorizeError(error)),
      )

      expect(output).toContain('Insufficient liquidity')
      expect(output).toContain('Available:')
    })

    test('handles UnsupportedChainError as validation', async () => {
      const error = new UnsupportedChainError(999, {
        traceId: 'trace-chain',
        statusCode: 400,
      })

      const result: OrchestratorResult<Portfolio> = errAsync(error)

      const output = await result.match(
        () => 'success',
        (error) => handlePortfolioError(categorizeError(error)),
      )

      expect(output).toBe('Invalid request: Unsupported chain 999')
    })

    test('handles server errors', async () => {
      const error = new ServiceUnavailableError({
        traceId: 'trace-503',
        statusCode: 503,
      })

      const result: OrchestratorResult<Portfolio> = errAsync(error)

      const output = await result.match(
        () => 'success',
        (error) => handlePortfolioError(categorizeError(error)),
      )

      expect(output).toContain('Server error')
      expect(output).toContain('try again later')
    })

    test('handles unknown OrchestratorError', async () => {
      const error = new OrchestratorError({
        message: 'Something unexpected happened',
        traceId: 'trace-unknown',
      })

      const result: OrchestratorResult<Portfolio> = errAsync(error)

      const output = await result.match(
        () => 'success',
        (error) => handlePortfolioError(categorizeError(error)),
      )

      expect(output).toBe('Unexpected error: Something unexpected happened')
    })
  })

  describe('Chaining with mapErr', () => {
    test('can transform errors in a pipeline', async () => {
      const error = new InsufficientBalanceError({ statusCode: 400 })
      const result: OrchestratorResult<Portfolio> = errAsync(error)

      // Chain error transformations
      const processed = result
        .map((p) => p.filter((t) => t.symbol === 'ETH'))
        .mapErr((e) => {
          // Log or transform the error
          return {
            originalError: e,
            userMessage: handlePortfolioError(categorizeError(e)),
            timestamp: Date.now(),
          }
        })

      const output = await processed.match(
        () => null,
        (transformed) => transformed,
      )

      expect(output).not.toBeNull()
      expect(output?.userMessage).toContain('Insufficient balance')
      expect(output?.originalError).toBeInstanceOf(InsufficientBalanceError)
    })
  })

  describe('isErr/isOk pattern', () => {
    test('can use isErr for early returns', async () => {
      const error = new NoPathFoundError({ statusCode: 422 })
      const result: OrchestratorResult<Portfolio> = errAsync(error)

      // Unwrap the ResultAsync to get a Result
      const syncResult = await result

      if (syncResult.isErr()) {
        const categorized = categorizeError(syncResult.error)
        expect(categorized.category).toBe(ErrorCategory.Validation)
        return
      }

      // TypeScript knows syncResult.value is Portfolio here
      expect(syncResult.value).toBeDefined()
    })
  })
})

describe('Error categorization', () => {
  test('categorizes all error types correctly', () => {
    const testCases: [OrchestratorError, CategorizedError['category']][] = [
      [new AuthenticationRequiredError({}), ErrorCategory.Auth],
      [new InvalidApiKeyError({}), ErrorCategory.Auth],
      [new ForbiddenError({}), ErrorCategory.Auth],
      [new InsufficientBalanceError({}), ErrorCategory.Balance],
      [new InsufficientLiquidityError({ availableIntents: [], unfillable: {} }), ErrorCategory.Balance],
      [new BadRequestError({}), ErrorCategory.Validation],
      [new UnsupportedChainError(1, {}), ErrorCategory.Validation],
      [new UnsupportedTokenError('ETH', 1, {}), ErrorCategory.Validation],
      [new NoPathFoundError({}), ErrorCategory.Validation],
      [new InternalServerError({}), ErrorCategory.Server],
      [new ServiceUnavailableError({}), ErrorCategory.Server],
      [new RateLimitedError({}), ErrorCategory.RateLimit],
      [new OrchestratorError({}), ErrorCategory.Unknown],
    ]

    for (const [error, expectedCategory] of testCases) {
      const categorized = categorizeError(error)
      expect(categorized.category).toBe(expectedCategory)
    }
  })
})
