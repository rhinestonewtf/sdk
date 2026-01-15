import type { Address } from 'viem'
import {
  AuthenticationRequiredError,
  BadRequestError,
  BodyParserError,
  ConflictError,
  ForbiddenError,
  InsufficientBalanceError,
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
  AccountType,
  Execution,
  IntentCost,
  IntentInput,
  IntentOpStatus,
  IntentResult,
  IntentRoute,
  Portfolio,
  PortfolioResponse,
  SignedIntentOp,
} from './types'
import { convertBigIntFields } from './utils'

export class Orchestrator {
  private serverUrl: string
  private apiKey?: string

  constructor(serverUrl: string, apiKey?: string) {
    this.serverUrl = serverUrl
    this.apiKey = apiKey
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
      params.set('chainIds', filter.chainIds.join(','))
    }
    if (filter?.tokens) {
      params.set(
        'tokens',
        Object.entries(filter.tokens)
          .flatMap(([chainId, tokens]) =>
            tokens.map((token) => `${chainId}:${token}`),
          )
          .join(','),
      )
    }
    const url = new URL(`${this.serverUrl}/accounts/${userAddress}/portfolio`)
    url.search = params.toString()
    const json = await this.fetch(url.toString(), {
      headers: this.getHeaders(),
    })
    const portfolioResponse = json.portfolio as PortfolioResponse
    const portfolio: Portfolio = portfolioResponse.map((tokenResponse) => ({
      symbol: tokenResponse.tokenName,
      decimals: tokenResponse.tokenDecimals,
      balances: {
        locked: BigInt(tokenResponse.balance.locked),
        unlocked: BigInt(tokenResponse.balance.unlocked),
      },
      chains: tokenResponse.tokenChainBalance.map((chainBalance) => ({
        chain: chainBalance.chainId,
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

    return portfolio
  }

  async getMaxTokenAmount(
    account: {
      address: Address
      accountType: AccountType
      setupOps: Pick<Execution, 'to' | 'data'>[]
    },
    destinationChainId: number,
    destinationTokenAddress: Address,
    destinationGasUnits: bigint,
    sponsored: boolean,
  ): Promise<bigint> {
    const intentCost = await this.getIntentCost({
      account,
      destinationExecutions: [],
      destinationChainId,
      destinationGasUnits,
      tokenRequests: [
        {
          tokenAddress: destinationTokenAddress,
        },
      ],
      options: {
        topupCompact: false,
        sponsorSettings: {
          gasSponsored: sponsored,
          bridgeFeesSponsored: sponsored,
          swapFeesSponsored: sponsored,
        },
      },
    })
    if (!intentCost.hasFulfilledAll) {
      return 0n
    }
    const tokenReceived = intentCost.tokensReceived.find(
      (token) =>
        token.tokenAddress.toLowerCase() ===
        destinationTokenAddress.toLowerCase(),
    )
    if (!tokenReceived) {
      return 0n
    }
    const tokenAmount = tokenReceived.destinationAmount
    if (BigInt(tokenAmount) < 0n) {
      return 0n
    }
    // `sponsorSettings` is not taken into account in the API response for now
    // As a workaround, we use the `amountSpent` if the transaction is sponsored
    return sponsored
      ? BigInt(tokenReceived.amountSpent)
      : BigInt(tokenReceived.destinationAmount)
  }

  async getIntentCost(input: IntentInput): Promise<IntentCost> {
    return await this.fetch(`${this.serverUrl}/intents/cost`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(convertBigIntFields(input)),
    })
  }

  async getIntentRoute(input: IntentInput): Promise<IntentRoute> {
    return await this.fetch(`${this.serverUrl}/intents/route`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(convertBigIntFields(input)),
    })
  }

  async submitIntent(
    signedIntentOpUnformatted: SignedIntentOp,
    dryRun: boolean,
  ): Promise<IntentResult> {
    const signedIntentOp = convertBigIntFields(signedIntentOpUnformatted)
    if (dryRun) {
      signedIntentOp.options = {
        dryRun: true,
      }
    }
    return await this.fetch(`${this.serverUrl}/intent-operations`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        signedIntentOp,
      }),
    })
  }

  async getIntentOpStatus(intentId: bigint): Promise<IntentOpStatus> {
    return await this.fetch(
      `${this.serverUrl}/intent-operation/${intentId.toString()}`,
      {
        headers: this.getHeaders(),
      },
    )
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey
    }
    return headers
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
    return response.json()
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
      const chainIdMatch = message.match(/Unsupported chain (\d+)/)
      if (chainIdMatch) {
        const chainId = parseInt(chainIdMatch[1], 10)
        throw new UnsupportedChainError(chainId, errorParams)
      }
      throw new UnsupportedChainIdError(errorParams)
    } else if (
      message.includes('Unsupported token') &&
      message.includes('for chain')
    ) {
      const tokenMatch = message.match(
        /Unsupported token (\w+) for chain (\d+)/,
      )
      if (tokenMatch) {
        const tokenSymbol = tokenMatch[1]
        const chainId = parseInt(tokenMatch[2], 10)
        throw new UnsupportedTokenError(tokenSymbol, chainId, errorParams)
      }
      throw new OrchestratorError({ message, ...errorParams })
    } else if (message === 'Unsupported token addresses') {
      // generic unsupported tokens without specific symbol/chain context
      throw new BadRequestError({ message, ...errorParams })
    } else if (message.includes('not supported on chain')) {
      const tokenMatch = message.match(
        /Token (.+) not supported on chain (\d+)/,
      )
      if (tokenMatch) {
        const tokenAddress = tokenMatch[1]
        const chainId = parseInt(tokenMatch[2], 10)
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
