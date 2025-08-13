import axios from 'axios'
import { type Address, concat, zeroAddress } from 'viem'
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
    try {
      const response = await axios.get(
        `${this.serverUrl}/accounts/${userAddress}/portfolio`,
        {
          params: {
            chainIds: filter?.chainIds?.join(','),
            tokens: filter?.tokens
              ? Object.entries(filter.tokens)
                  .map(([chainId, tokens]) =>
                    tokens.map((token) => `${chainId}:${token}`),
                  )
                  .reduce(concat, [])
              : undefined,
          },
          headers: {
            'x-api-key': this.apiKey,
          },
        },
      )
      const portfolioResponse = response.data.portfolio as PortfolioResponse
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
    } catch (error) {
      this.parseError(error)
      throw new Error('Failed to get portfolio')
    }
  }

  async getMaxTokenAmount(
    userAddress: Address,
    destinationChainId: number,
    destinationTokenAddress: Address,
    destinationGasUnits: bigint,
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
        delegations: {},
      },
      destinationExecutions: [],
      destinationChainId,
      destinationGasUnits,
      tokenTransfers: [
        {
          tokenAddress: destinationTokenAddress,
        },
      ],
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
    return tokenReceived.destinationAmount
  }

  async getIntentCost(input: IntentInput): Promise<IntentCost> {
    try {
      const response = await axios.post(
        `${this.serverUrl}/intents/cost`,
        {
          ...convertBigIntFields({
            ...input,
            tokenTransfers: input.tokenTransfers.map((transfer) => ({
              tokenAddress: transfer.tokenAddress,
            })),
          }),
        },
        {
          headers: {
            'x-api-key': this.apiKey,
          },
        },
      )

      return response.data
    } catch (error) {
      this.parseError(error)
      throw new Error('Failed to get intent cost')
    }
  }

  async getIntentRoute(input: IntentInput): Promise<IntentRoute> {
    try {
      const response = await axios.post(
        `${this.serverUrl}/intents/route`,
        {
          ...convertBigIntFields(input),
        },
        {
          headers: {
            'x-api-key': this.apiKey,
          },
        },
      )

      return response.data
    } catch (error) {
      this.parseError(error)
      throw new Error('Failed to get intent route')
    }
  }

  async submitIntent(signedIntentOp: SignedIntentOp): Promise<IntentResult> {
    try {
      const response = await axios.post(
        `${this.serverUrl}/intent-operations`,
        {
          signedIntentOp: convertBigIntFields(signedIntentOp),
        },
        {
          headers: {
            'x-api-key': this.apiKey,
          },
        },
      )

      return response.data
    } catch (error) {
      this.parseError(error)
      throw new Error('Failed to submit intent')
    }
  }

  async simulateIntent(signedIntentOp: SignedIntentOp): Promise<IntentResult> {
    try {
      const response = await axios.post(
        `${this.serverUrl}/intent-operations/simulate`,
        {
          signedIntentOp: convertBigIntFields(signedIntentOp),
        },
        {
          headers: {
            'x-api-key': this.apiKey,
          },
        },
      )

      return response.data
    } catch (error) {
      this.parseError(error)
      throw new Error('Failed to simulate intent')
    }
  }

  async getIntentOpStatus(intentId: bigint): Promise<IntentOpStatus> {
    try {
      const response = await axios.get(
        `${this.serverUrl}/intent-operation/${intentId.toString()}/status`,
        {
          headers: {
            'x-api-key': this.apiKey,
          },
        },
      )

      return response.data
    } catch (error) {
      this.parseError(error)
      throw new Error('Failed to get intent op status')
    }
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
      if (error.response.data) {
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
          let errorMessage = `Rhinestone Error: ${err.message}`
          if (errorType) {
            errorMessage += ` (${errorType})`
          }
          if (traceId) {
            errorMessage += ` [Trace ID: ${traceId}]`
            context.traceId = traceId
          }
          console.error(errorMessage)
          if (err.context) {
            console.error(
              `Context: ${JSON.stringify(err.context, undefined, 4)}`,
            )
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
      } else {
        console.error(error)
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
