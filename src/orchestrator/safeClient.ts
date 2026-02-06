import type { Address } from 'viem'
import { ResultAsync } from 'neverthrow'
import { Orchestrator } from './client'
import { PROD_ORCHESTRATOR_URL } from './consts'
import {
  type OrchestratorError,
  AuthenticationRequiredError,
  BadRequestError,
  ForbiddenError,
  InsufficientBalanceError,
  InsufficientLiquidityError,
  InternalServerError,
  InvalidApiKeyError,
  NoPathFoundError,
  RateLimitedError,
  ServiceUnavailableError,
  UnsupportedChainError,
  UnsupportedChainIdError,
  UnsupportedTokenError,
  TokenNotSupportedError,
} from './error'
import type {
  IntentInput,
  IntentOpStatus,
  IntentResult,
  IntentRoute,
  Portfolio,
  SignedIntentOp,
  SplitIntentsInput,
  SplitIntentsResult,
} from './types'

/**
 * A Result type that wraps orchestrator responses.
 * Success contains the value T, Error contains an OrchestratorError.
 */
export type OrchestratorResult<T> = ResultAsync<T, OrchestratorError>

/**
 * Error categories for discriminated union pattern matching.
 */
export const ErrorCategory = {
  Auth: 'auth',
  Balance: 'balance',
  Validation: 'validation',
  Server: 'server',
  RateLimit: 'rate_limit',
  Unknown: 'unknown',
} as const

export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory]

/**
 * Discriminated union for categorized error handling.
 * Enables exhaustive switch statements with TypeScript.
 */
export type CategorizedError =
  | { category: typeof ErrorCategory.Auth; error: AuthenticationRequiredError | InvalidApiKeyError | ForbiddenError }
  | { category: typeof ErrorCategory.Balance; error: InsufficientBalanceError | InsufficientLiquidityError }
  | { category: typeof ErrorCategory.Validation; error: BadRequestError | UnsupportedChainError | UnsupportedChainIdError | UnsupportedTokenError | TokenNotSupportedError | NoPathFoundError }
  | { category: typeof ErrorCategory.Server; error: InternalServerError | ServiceUnavailableError }
  | { category: typeof ErrorCategory.RateLimit; error: RateLimitedError; retryAfter?: string }
  | { category: typeof ErrorCategory.Unknown; error: OrchestratorError }

/**
 * Categorize an OrchestratorError into a discriminated union.
 * Enables exhaustive pattern matching in switch statements.
 *
 * @example
 * ```ts
 * const result = await client.getPortfolio(address)
 *
 * if (result.isErr()) {
 *   const categorized = categorizeError(result.error)
 *   switch (categorized.category) {
 *     case 'auth':
 *       // Handle auth errors
 *       break
 *     case 'balance':
 *       // Handle balance errors
 *       break
 *     // ... TypeScript ensures all cases are handled
 *   }
 * }
 * ```
 */
export function categorizeError(error: OrchestratorError): CategorizedError {
  if (
    error instanceof AuthenticationRequiredError ||
    error instanceof InvalidApiKeyError ||
    error instanceof ForbiddenError
  ) {
    return { category: ErrorCategory.Auth, error }
  }

  if (
    error instanceof InsufficientBalanceError ||
    error instanceof InsufficientLiquidityError
  ) {
    return { category: ErrorCategory.Balance, error }
  }

  if (
    error instanceof BadRequestError ||
    error instanceof UnsupportedChainError ||
    error instanceof UnsupportedChainIdError ||
    error instanceof UnsupportedTokenError ||
    error instanceof TokenNotSupportedError ||
    error instanceof NoPathFoundError
  ) {
    return { category: ErrorCategory.Validation, error }
  }

  if (
    error instanceof InternalServerError ||
    error instanceof ServiceUnavailableError
  ) {
    return { category: ErrorCategory.Server, error }
  }

  if (error instanceof RateLimitedError) {
    return {
      category: ErrorCategory.RateLimit,
      error,
      retryAfter: error.context?.retryAfter,
    }
  }

  return { category: ErrorCategory.Unknown, error }
}

/**
 * A wrapper around the Orchestrator client that returns Result types
 * instead of throwing exceptions. This forces explicit error handling
 * and provides a more functional API.
 *
 * @example
 * ```ts
 * const client = new SafeOrchestrator(url, apiKey)
 *
 * const result = await client.getPortfolio(address)
 *
 * if (result.isErr()) {
 *   // Handle error - TypeScript knows result.error is OrchestratorError
 *   console.error(result.error.message)
 *   return
 * }
 *
 * // TypeScript knows result.value is Portfolio
 * console.log(result.value)
 * ```
 */
export class SafeOrchestrator {
  private client: Orchestrator

  constructor(serverUrl: string, apiKey?: string) {
    this.client = new Orchestrator(serverUrl, apiKey)
  }

  /**
   * Get the portfolio (token balances) for an account.
   */
  getPortfolio(
    userAddress: Address,
    filter?: {
      chainIds?: number[]
      tokens?: {
        [chainId: number]: Address[]
      }
    },
  ): OrchestratorResult<Portfolio> {
    return ResultAsync.fromPromise(
      this.client.getPortfolio(userAddress, filter),
      (error) => error as OrchestratorError,
    )
  }

  /**
   * Get the intent route for a given intent input.
   */
  getIntentRoute(input: IntentInput): OrchestratorResult<IntentRoute> {
    return ResultAsync.fromPromise(
      this.client.getIntentRoute(input),
      (error) => error as OrchestratorError,
    )
  }

  /**
   * Split intents into smaller chunks based on liquidity availability.
   */
  splitIntents(input: SplitIntentsInput): OrchestratorResult<SplitIntentsResult> {
    return ResultAsync.fromPromise(
      this.client.splitIntents(input),
      (error) => error as OrchestratorError,
    )
  }

  /**
   * Submit a signed intent operation to the orchestrator.
   */
  submitIntent(
    signedIntentOp: SignedIntentOp,
    dryRun: boolean,
  ): OrchestratorResult<IntentResult> {
    return ResultAsync.fromPromise(
      this.client.submitIntent(signedIntentOp, dryRun),
      (error) => error as OrchestratorError,
    )
  }

  /**
   * Get the status of a submitted intent operation.
   */
  getIntentOpStatus(intentId: bigint): OrchestratorResult<IntentOpStatus> {
    return ResultAsync.fromPromise(
      this.client.getIntentOpStatus(intentId),
      (error) => error as OrchestratorError,
    )
  }
}

/**
 * Factory function to create a SafeOrchestrator with default production URL.
 */
export function getSafeOrchestrator(
  apiKey?: string,
  orchestratorUrl?: string,
): SafeOrchestrator {
  return new SafeOrchestrator(orchestratorUrl ?? PROD_ORCHESTRATOR_URL, apiKey)
}
