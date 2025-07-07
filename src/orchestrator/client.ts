import axios from 'axios'
import { type Address, concat } from 'viem'
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
  SignedIntentOp,
  UserTokenBalance,
} from './types'
import { convertBigIntFields } from './utils'

export class Orchestrator {
  private serverUrl: string
  private apiKey: string

  constructor(serverUrl: string, apiKey: string) {
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
  ): Promise<UserTokenBalance[]> {
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
      return response.data.portfolio.map((balance: any) => {
        return {
          ...balance,
          balance: BigInt(balance.balance),
          tokenChainBalance: balance.tokenChainBalance.map(
            (chainBalance: any) => {
              return {
                ...chainBalance,
                balance: BigInt(chainBalance.balance),
              }
            },
          ),
        }
      })
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
      account: userAddress,
      destinationExecutions: [],
      destinationChainId,
      destinationGasUnits,
      tokenTransfers: [
        {
          tokenAddress: destinationTokenAddress,
        },
      ],
      smartAccount: {
        accountType: 'ERC7579',
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
    return tokenReceived.destinationAmount
  }

  async getIntentCost(input: IntentInput): Promise<IntentCost> {
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
  }

  async getIntentRoute(input: IntentInput): Promise<IntentRoute> {
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
  }

  async submitIntent(signedIntentOp: SignedIntentOp): Promise<IntentResult> {
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
  }

  async getIntentOpStatus(intentId: bigint): Promise<IntentOpStatus> {
    const response = await axios.get(
      `${this.serverUrl}/intent-operation/${intentId.toString()}/status`,
      {
        headers: {
          'x-api-key': this.apiKey,
        },
      },
    )

    return response.data
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
        const { errors, traceId } = error.response.data
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

          if (message === 'Insufficient balance') {
            throw new InsufficientBalanceError(finalErrorParams)
          } else if (message === 'Unsupported chain id') {
            throw new UnsupportedChainIdError(finalErrorParams)
          } else if (message.startsWith('Unsupported chain ')) {
            const chainIdMatch = message.match(/Unsupported chain (\d+)/)
            if (chainIdMatch) {
              const chainId = parseInt(chainIdMatch[1], 10)
              throw new UnsupportedChainError(chainId, finalErrorParams)
            }
            throw new UnsupportedChainIdError(finalErrorParams)
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
              throw new UnsupportedTokenError(
                tokenSymbol,
                chainId,
                finalErrorParams,
              )
            }
            throw new OrchestratorError({ message, ...finalErrorParams })
          } else if (message.includes('not supported on chain')) {
            const tokenMatch = message.match(
              /Token (.+) not supported on chain (\d+)/,
            )
            if (tokenMatch) {
              const tokenAddress = tokenMatch[1]
              const chainId = parseInt(tokenMatch[2], 10)
              throw new TokenNotSupportedError(
                tokenAddress,
                chainId,
                finalErrorParams,
              )
            }
            throw new OrchestratorError({ message, ...finalErrorParams })
          } else if (message === 'Authentication is required') {
            throw new AuthenticationRequiredError(finalErrorParams)
          } else if (message === 'Invalid API key') {
            throw new InvalidApiKeyError(finalErrorParams)
          } else if (message === 'Invalid bundle signature') {
            throw new InvalidIntentSignatureError(finalErrorParams)
          } else if (message === 'Only one target token amount can be unset') {
            throw new OnlyOneTargetTokenAmountCanBeUnsetError(finalErrorParams)
          } else if (message === 'No Path Found') {
            throw new NoPathFoundError(finalErrorParams)
          } else if (message === 'Order bundle not found') {
            throw new IntentNotFoundError(finalErrorParams)
          } else {
            throw new OrchestratorError({ message, ...finalErrorParams })
          }
        }
      } else {
        console.error(error)
      }
    }
  }
}
