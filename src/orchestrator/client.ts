import { type Address, zeroAddress } from 'viem'
import {
  AuthenticationRequiredError,
  InsufficientBalanceError,
  IntentNotFoundError,
  InvalidApiKeyError,
  InvalidIntentSignatureError,
  NoPathFoundError,
  OnlyOneTargetTokenAmountCanBeUnsetError,
  OrchestratorError,
  TokenNotSupportedError,
  UnsupportedChainError,
  UnsupportedChainIdError,
  UnsupportedTokenError,
} from './error'
import type {
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
    userAddress: Address,
    destinationChainId: number,
    destinationTokenAddress: Address,
    destinationGasUnits: bigint,
    sponsored: boolean,
  ): Promise<bigint> {
    const intentCost = await this.getIntentCost({
      account: {
        address: userAddress,
        accountType: 'ERC7579',
        setupOps: [
          {
            to: zeroAddress,
            data: '0x',
          },
        ],
      },
      destinationExecutions: [],
      destinationChainId,
      destinationGasUnits,
      tokenTransfers: [
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
    if (tokenAmount < 0n) {
      throw new Error(
        `Balance not available. Make sure the account is deployed`,
      )
    }
    // `sponsorSettings` is not taken into account in the API response for now
    // As a workaround, we use the `amountSpent` if the transaction is sponsored
    return sponsored
      ? tokenReceived.amountSpent
      : tokenReceived.destinationAmount
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
      `${this.serverUrl}/intent-operation/${intentId.toString()}/status`,
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
      const errorData = await response.json().catch(() => ({}))
      this.parseError({
        response: {
          status: response.status,
          data: errorData,
        },
      })
    }
    return response.json()
  }

  private parseError(error: any) {
    if (error.response) {
      let errorType: string | undefined
      if (error.response.status) {
        switch (error.response.status) {
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
          case 500:
            errorType = 'Internal Server Error'
            break
          default:
            errorType = 'Unknown'
        }
      }
      let context: any = {}
      if (!error.response.data) {
        return
      }
      const { errors, traceId, message } = error.response.data
      if (message) {
        const mainErrorParams = {
          context: { traceId },
          errorType,
          traceId,
        }
        this.parseErrorMessage(message, mainErrorParams)
      }

      for (const err of errors) {
        if (traceId) {
          context.traceId = traceId
        }
        context = { ...context, ...err.context }

        const message = err.message
        const finalErrorParams = {
          context: { ...context, traceId },
          errorType,
          traceId,
        }

        this.parseErrorMessage(message, finalErrorParams)
      }
    }
  }

  private parseErrorMessage(message: string, errorParams: any) {
    if (message === 'Insufficient balance') {
      throw new InsufficientBalanceError(errorParams)
    } else if (message === 'Unsupported chain id') {
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
    } else if (message === 'Invalid bundle signature') {
      throw new InvalidIntentSignatureError(errorParams)
    } else if (message === 'Only one target token amount can be unset') {
      throw new OnlyOneTargetTokenAmountCanBeUnsetError(errorParams)
    } else if (message === 'No Path Found') {
      throw new NoPathFoundError(errorParams)
    } else if (message === 'Order bundle not found') {
      throw new IntentNotFoundError(errorParams)
    } else {
      throw new OrchestratorError({ message, ...errorParams })
    }
  }
}
