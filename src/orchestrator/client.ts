import type { Address } from 'viem'
import type { AuthProvider } from '../auth/provider'
import { fromCaip2, isCaip2, toCaip2 } from './caip2'
import {
  DEFAULT_ORCHESTRATOR_API_VERSION,
  ORCHESTRATOR_API_VERSION_HEADERS,
  type OrchestratorApiVersion,
  SDK_VERSION,
} from './consts'
import {
  AuthenticationRequiredError,
  BadRequestError,
  BodyParserError,
  ConflictError,
  ForbiddenError,
  InsufficientBalanceError,
  InsufficientLiquidityError,
  IntentNotFoundError,
  InternalServerError,
  InvalidApiKeyError,
  InvalidIntentSignatureError,
  NoPathFoundError,
  OnlyOneTargetTokenAmountCanBeUnsetError,
  OrchestratorError,
  RateLimitedError,
  ResourceNotFoundError,
  ServiceUnavailableError,
  SimulationFailedError,
  TokenNotSupportedError,
  UnauthorizedError,
  UnsupportedChainError,
  UnsupportedChainIdError,
  UnsupportedTokenError,
} from './error'
import type {
  IntentInput,
  IntentOpStatus,
  IntentResult,
  IntentRoute,
  Portfolio,
  PortfolioResponse,
  SignedIntentOp,
  SplitIntentsInput,
  SplitIntentsResult,
} from './types'
import {
  convertBigIntFields,
  decodeChainIdsFromWire,
  encodeChainIdsForWire,
} from './utils'

function parseTokenAmountsRecord(
  record: Record<string, string>,
): Record<Address, bigint> {
  return Object.fromEntries(
    Object.entries(record).map(([addr, amount]) => [
      addr as Address,
      BigInt(amount),
    ]),
  ) as Record<Address, bigint>
}

/**
 * Restores chain ids that are numeric in the SDK surface after the generic wire decoder
 * has converted BLANC CAIP-2 strings back to legacy decimal strings.
 */
function toNumericChainId(chainId: number | string): number {
  return typeof chainId === 'number' ? chainId : Number(chainId)
}

/**
 * Portfolio balances still expose numeric chain ids publicly even when the wire format is BLANC.
 */
function parsePortfolio(portfolioResponse: PortfolioResponse): Portfolio {
  return portfolioResponse.map((tokenResponse) => ({
    symbol: tokenResponse.tokenName,
    decimals: tokenResponse.tokenDecimals,
    balances: {
      locked: BigInt(tokenResponse.balance.locked),
      unlocked: BigInt(tokenResponse.balance.unlocked),
    },
    chains: tokenResponse.tokenChainBalance.map((chainBalance) => ({
      chain: toNumericChainId(chainBalance.chainId),
      address: chainBalance.tokenAddress,
      locked: BigInt(chainBalance.balance.locked),
      unlocked: BigInt(chainBalance.balance.unlocked),
    })) as [
      {
        isAccountDeployed: boolean
        chain: number
        address: Address
        locked: bigint
        unlocked: bigint
      },
    ],
  }))
}

/**
 * Intent-status endpoints return numeric chain ids to SDK callers even though BLANC sends CAIP-2.
 */
function parseIntentOpStatus(status: IntentOpStatus): IntentOpStatus {
  return {
    ...status,
    destinationChainId: toNumericChainId(status.destinationChainId),
    claims: status.claims.map((claim) => ({
      ...claim,
      chainId: toNumericChainId(claim.chainId),
    })),
  }
}

/**
 * Route responses still expose numeric gas-cost chain ids while leaving signed payload fields untouched.
 */
function parseIntentRoute(route: IntentRoute): IntentRoute {
  if (!route.intentCost.gasCost) {
    return route
  }

  return {
    ...route,
    intentCost: {
      ...route.intentCost,
      gasCost: {
        ...route.intentCost.gasCost,
        originChains: route.intentCost.gasCost.originChains.map(
          (originChain) => ({
            ...originChain,
            chainId: toNumericChainId(originChain.chainId),
          }),
        ),
        destination: {
          ...route.intentCost.gasCost.destination,
          chainId: toNumericChainId(
            route.intentCost.gasCost.destination.chainId,
          ),
        },
      },
    },
  }
}

export class Orchestrator {
  private serverUrl: string
  private authProvider: AuthProvider
  private extraHeaders?: Record<string, string>
  private apiVersion: OrchestratorApiVersion

  constructor(
    serverUrl: string,
    authProvider: AuthProvider,
    headers?: Record<string, string>,
    apiVersion: OrchestratorApiVersion = DEFAULT_ORCHESTRATOR_API_VERSION,
  ) {
    this.serverUrl = serverUrl
    this.authProvider = authProvider
    this.extraHeaders = headers
    this.apiVersion = apiVersion
  }

  async getPortfolio(
    userAddress: Address,
    filter?: {
      chainIds?: number[]
      tokens?: {
        [chainId: number]: Address[]
      }
    },
  ): Promise<Portfolio> {
    const params = new URLSearchParams()
    if (filter?.chainIds) {
      if (this.apiVersion === 'blanc') {
        for (const chainId of filter.chainIds) {
          params.append('chainIds', toCaip2(chainId))
        }
      } else {
        params.set('chainIds', filter.chainIds.join(','))
      }
    }
    if (filter?.tokens) {
      const tokenEntries = Object.entries(filter.tokens)

      if (this.apiVersion === 'blanc') {
        for (const [chainId, tokens] of tokenEntries) {
          const caip2ChainId = toCaip2(Number(chainId))
          for (const token of tokens) {
            params.append('tokens', `${caip2ChainId}:${token}`)
          }
        }
      } else {
        params.set(
          'tokens',
          tokenEntries
            .flatMap(([chainId, tokens]) =>
              tokens.map((token) => `${chainId}:${token}`),
            )
            .join(','),
        )
      }
    }
    const url = new URL(`${this.serverUrl}/accounts/${userAddress}/portfolio`)
    url.search = params.toString()
    const json = await this.fetch(url.toString(), {
      headers: await this.getHeaders(),
    })

    return parsePortfolio(json.portfolio as PortfolioResponse)
  }

  async getIntentRoute(input: IntentInput): Promise<IntentRoute> {
    const body = encodeChainIdsForWire(
      convertBigIntFields(input),
      this.apiVersion,
    )
    return parseIntentRoute(
      await this.fetch(`${this.serverUrl}/intents/route`, {
        method: 'POST',
        headers: await this.getHeaders(),
        body: JSON.stringify(body),
      }),
    )
  }

  async splitIntents(input: SplitIntentsInput): Promise<SplitIntentsResult> {
    const body = encodeChainIdsForWire(
      convertBigIntFields({
        chainId: input.chain.id,
        tokens: input.tokens,
        settlementLayers: input.settlementLayers,
      }),
      this.apiVersion,
    )

    const response = await fetch(`${this.serverUrl}/intents/split`, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify(body),
    })

    if (response.ok) {
      const json = decodeChainIdsFromWire(
        await response.json(),
        this.apiVersion,
      ) as { intents: Record<string, string>[] }
      return {
        intents: json.intents.map(parseTokenAmountsRecord),
      }
    }

    let errorData: any = {}
    try {
      errorData = await response.json()
    } catch {
      try {
        const text = await response.text()
        errorData = { message: text }
      } catch {}
    }

    if (
      response.status === 422 &&
      errorData.error === 'INSUFFICIENT_LIQUIDITY'
    ) {
      throw new InsufficientLiquidityError({
        availableIntents: (
          errorData.availableIntents as Record<string, string>[]
        ).map(parseTokenAmountsRecord),
        unfillable: parseTokenAmountsRecord(errorData.unfillable),
        traceId: errorData.traceId,
        statusCode: 422,
      })
    }

    this.parseError({
      response: {
        status: response.status,
        data: errorData,
        headers: {},
      },
    })
    throw new OrchestratorError({ message: 'Unexpected error' })
  }

  async submitIntent(
    signedIntentOpUnformatted: SignedIntentOp,
    dryRun: boolean,
    policyContext?: { intentInput: unknown; isSponsored: boolean },
  ): Promise<IntentResult> {
    const signedIntentOp = encodeChainIdsForWire(
      convertBigIntFields(signedIntentOpUnformatted),
      this.apiVersion,
    )
    if (dryRun) {
      signedIntentOp.options = {
        dryRun: true,
      }
    }
    const body = { signedIntentOp }
    const headers = policyContext
      ? await this.getSubmitHeaders(
          policyContext.intentInput,
          policyContext.isSponsored,
        )
      : await this.getHeaders()
    return await this.fetch(`${this.serverUrl}/intent-operations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  }

  async getIntentOpStatus(intentId: bigint): Promise<IntentOpStatus> {
    return parseIntentOpStatus(
      await this.fetch(
        `${this.serverUrl}/intent-operation/${intentId.toString()}`,
        {
          headers: await this.getHeaders(),
        },
      ),
    )
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const auth = await this.authProvider.getHeaders()
    return {
      'Content-Type': 'application/json',
      'x-sdk-version': SDK_VERSION,
      ...auth,
      ...this.extraHeaders,
      'x-api-version': ORCHESTRATOR_API_VERSION_HEADERS[this.apiVersion],
    }
  }

  private async getSubmitHeaders(
    intentInput: unknown,
    isSponsored: boolean,
  ): Promise<Record<string, string>> {
    const auth = await this.authProvider.getSubmitHeaders(
      intentInput,
      isSponsored,
    )
    return {
      'Content-Type': 'application/json',
      'x-sdk-version': SDK_VERSION,
      ...auth,
      ...this.extraHeaders,
      'x-api-version': ORCHESTRATOR_API_VERSION_HEADERS[this.apiVersion],
    }
  }

  private async fetch(url: string, options?: RequestInit): Promise<any> {
    const response = await fetch(url, options)

    if (!response.ok) {
      let errorData: any = {}
      try {
        errorData = await response.json()
      } catch {
        try {
          const text = await response.text()
          errorData = { message: text }
        } catch {}
      }
      const retryAfterHeader =
        response.headers?.get?.('retry-after') || undefined
      this.parseError({
        response: {
          status: response.status,
          data: errorData,
          headers: {
            retryAfter: retryAfterHeader,
          },
        },
      })
    }
    return decodeChainIdsFromWire(await response.json(), this.apiVersion)
  }

  private parseError(error: any) {
    if (error.response) {
      const status: number | undefined = error.response.status
      const { headers } = error.response
      const { errors = [], traceId, message } = error.response.data || {}

      let errorType: string = 'Unknown'
      switch (status) {
        case 400:
          errorType = 'Bad Request'
          break
        case 401:
          errorType = 'Unauthorized'
          break
        case 403:
          errorType = 'Forbidden'
          break
        case 404:
          errorType = 'Not Found'
          break
        case 409:
          errorType = 'Conflict'
          break
        case 422:
          errorType = 'Unprocessable Entity'
          break
        case 429:
          errorType = 'Too Many Requests'
          break
        case 500:
          errorType = 'Internal Server Error'
          break
        case 503:
          errorType = 'Service Unavailable'
          break
        default:
          errorType = 'Unknown'
      }

      const baseParams = {
        context: { traceId },
        errorType,
        traceId,
        statusCode: status,
      }

      if (status === 429) {
        const retryAfter = headers?.retryAfter
        const context = { traceId, retryAfter }
        throw new RateLimitedError({
          ...baseParams,
          context,
        })
      }
      if (status === 503) {
        throw new ServiceUnavailableError(baseParams)
      }

      if (message) {
        this.parseErrorMessage(message as string, baseParams)
      }

      for (const err of errors) {
        const mergedParams = {
          ...baseParams,
          context: { ...err.context, traceId },
        }
        this.parseErrorMessage(err.message, mergedParams)
      }

      switch (status) {
        case 400:
          throw new BadRequestError({
            ...baseParams,
            context: { traceId, errors },
            message: message as string,
          })
        case 401:
          if (message === 'Authentication is required') {
            throw new AuthenticationRequiredError(baseParams)
          }
          throw new UnauthorizedError(baseParams)
        case 403:
          throw new ForbiddenError(baseParams)
        case 404:
          throw new ResourceNotFoundError(baseParams)
        case 409:
          throw new ConflictError(baseParams)
        case 500:
          if (errors && errors.length > 0) {
            const mergedParams = {
              ...baseParams,
              context: { ...errors[0].context, traceId },
            }
            throw new OrchestratorError({
              ...mergedParams,
              message: errors[0].message || 'Internal Server Error',
            })
          }
          throw new InternalServerError(baseParams)
        default:
          throw new OrchestratorError({
            ...baseParams,
            message: (message as string) || errorType,
          })
      }
    }
  }

  private parseErrorMessage(message: string, errorParams: any) {
    if (message === 'Insufficient balance') {
      throw new InsufficientBalanceError(errorParams)
    } else if (
      message === 'Unsupported chain id' ||
      message === 'Unsupported chain ids'
    ) {
      throw new UnsupportedChainIdError(errorParams)
    } else if (message.startsWith('Unsupported chain ')) {
      const chainIdMatch = message.match(/Unsupported chain ((?:eip155:)?\d+)/)
      if (chainIdMatch) {
        const chainId = parseErrorChainId(chainIdMatch[1])
        throw new UnsupportedChainError(chainId, errorParams)
      }
      throw new UnsupportedChainIdError(errorParams)
    } else if (
      message.includes('Unsupported token') &&
      message.includes('for chain')
    ) {
      const tokenMatch = message.match(
        /Unsupported token (\w+) for chain ((?:eip155:)?\d+)/,
      )
      if (tokenMatch) {
        const tokenSymbol = tokenMatch[1]
        const chainId = parseErrorChainId(tokenMatch[2])
        throw new UnsupportedTokenError(tokenSymbol, chainId, errorParams)
      }
      throw new OrchestratorError({ message, ...errorParams })
    } else if (message === 'Unsupported token addresses') {
      // generic unsupported tokens without specific symbol/chain context
      throw new BadRequestError({ message, ...errorParams })
    } else if (message.includes('not supported on chain')) {
      const tokenMatch = message.match(
        /Token (.+) not supported on chain ((?:eip155:)?\d+)/,
      )
      if (tokenMatch) {
        const tokenAddress = tokenMatch[1]
        const chainId = parseErrorChainId(tokenMatch[2])
        throw new TokenNotSupportedError(tokenAddress, chainId, errorParams)
      }
      throw new OrchestratorError({ message, ...errorParams })
    } else if (message === 'Authentication is required') {
      throw new AuthenticationRequiredError(errorParams)
    } else if (message === 'Invalid API key') {
      throw new InvalidApiKeyError(errorParams)
    } else if (message === 'Insufficient permissions') {
      throw new ForbiddenError(errorParams)
    } else if (message === 'Invalid bundle signature') {
      throw new InvalidIntentSignatureError(errorParams)
    } else if (message === 'Invalid checksum signature') {
      throw new InvalidIntentSignatureError(errorParams)
    } else if (
      message === 'Only one target token amount can be unset' ||
      message === 'Only one max-out transfer is allowed'
    ) {
      throw new OnlyOneTargetTokenAmountCanBeUnsetError(errorParams)
    } else if (
      message === 'No valid settlement plan found for the given transfers' ||
      message === 'No valid transfers sent for settlement quotes' ||
      message === 'No Path Found'
    ) {
      throw new NoPathFoundError(errorParams)
    } else if (
      message === 'Emissary is not enabled' ||
      message === 'Emissary is not the expected address'
    ) {
      throw new ForbiddenError(errorParams)
    } else if (
      message.includes('No such intent with nonce') ||
      message === 'Order bundle not found'
    ) {
      throw new IntentNotFoundError(errorParams)
    } else if (
      message === 'Could not retrieve a valid quote from any aggregator'
    ) {
      throw new NoPathFoundError(errorParams)
    } else if (message === 'No aggregators available for swap') {
      throw new InternalServerError(errorParams)
    } else if (
      message === 'entity.parse.failed' ||
      message === 'entity.too.large' ||
      message === 'encoding.unsupported'
    ) {
      throw new BodyParserError({ message, ...errorParams })
    } else if (message === 'Bundle simulation failed') {
      const simulations = errorParams.context.error.simulations
      const { traceId, errorType, statusCode, context } = errorParams
      throw new SimulationFailedError({
        message,
        context,
        errorType,
        traceId,
        statusCode,
        simulations,
      })
    } else {
      throw new OrchestratorError({ message, ...errorParams })
    }
  }
}

/**
 * Error messages can contain either legacy decimal ids or BLANC CAIP-2 ids.
 */
function parseErrorChainId(chainId: string): number {
  return isCaip2(chainId) ? fromCaip2(chainId) : Number(chainId)
}
