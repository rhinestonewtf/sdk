import axios from 'axios'
import { type Address, concat, type Hex } from 'viem'
import type { UserOperation } from 'viem/account-abstraction'

import { OrchestratorError } from './error'
import type {
  BundleEvent,
  BundleResult,
  GasPrices,
  MetaIntent,
  OPNetworkParams,
  OrderCostResult,
  OrderFeeInput,
  OrderPath,
  PostOrderBundleResult,
  SignedMultiChainCompact,
  TokenPrices,
  UserTokenBalance,
} from './types'
import {
  convertBigIntFields,
  parseCompactResponse,
  parseOrderCost,
  parseOrderCostResult,
  parsePendingBundleEvent,
} from './utils'

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
            chainIds: filter?.chainIds,
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
    targetChainId: number,
    targetTokenAddress: Address,
    targetGasUnits: bigint,
  ): Promise<bigint> {
    const intentCost = await this.getIntentCost(
      {
        targetChainId,
        targetGasUnits,
        tokenTransfers: [
          {
            tokenAddress: targetTokenAddress,
          },
        ],
      },
      userAddress,
    )
    if (!intentCost.hasFulfilledAll) {
      return 0n
    }
    const tokenReceived = intentCost.tokensReceived.find(
      (token) =>
        token.tokenAddress.toLowerCase() === targetTokenAddress.toLowerCase(),
    )
    if (!tokenReceived) {
      return 0n
    }
    const tokenAmount = tokenReceived.targetAmount
    if (tokenAmount < 0n) {
      throw new Error(
        `Balance not available. Make sure the account is deployed`,
      )
    }
    return tokenReceived.targetAmount
  }

  async getIntentCost(
    intent: OrderFeeInput,
    userAddress: Address,
  ): Promise<OrderCostResult> {
    try {
      const response = await axios.post(
        `${this.serverUrl}/accounts/${userAddress}/bundles/cost`,
        {
          ...convertBigIntFields(intent),
        },
        {
          headers: {
            'x-api-key': this.apiKey,
          },
        },
      )

      return parseOrderCostResult(response.data)
    } catch (error: any) {
      this.parseError(error)
      throw new Error(error)
    }
  }

  async getOrderPath(
    intent: MetaIntent,
    userAddress: Address,
  ): Promise<OrderPath> {
    try {
      const response = await axios.post(
        `${this.serverUrl}/accounts/${userAddress}/bundles/path`,
        {
          ...convertBigIntFields(intent),
        },
        {
          headers: {
            'x-api-key': this.apiKey,
          },
        },
      )

      return response.data.orderBundles.map((orderPath: any) => {
        return {
          orderBundle: parseCompactResponse(orderPath.orderBundle),
          injectedExecutions: orderPath.injectedExecutions.map((exec: any) => {
            return {
              ...exec,
              value: BigInt(exec.value),
            }
          }),
          intentCost: parseOrderCost(orderPath.intentCost),
        }
      })
    } catch (error: any) {
      this.parseError(error)
      throw new Error(error)
    }
  }

  async postSignedOrderBundle(
    signedOrderBundles: {
      signedOrderBundle: SignedMultiChainCompact
      initCode?: Hex
      userOp?: UserOperation
    }[],
  ): Promise<PostOrderBundleResult> {
    try {
      const bundles = signedOrderBundles.map(
        (signedOrderBundle: {
          signedOrderBundle: SignedMultiChainCompact
          initCode?: Hex
          userOp?: UserOperation
        }) => {
          return {
            signedOrderBundle: convertBigIntFields(
              signedOrderBundle.signedOrderBundle,
            ),
            initCode: signedOrderBundle.initCode,
            userOp: signedOrderBundle.userOp
              ? convertBigIntFields(signedOrderBundle.userOp)
              : undefined,
          }
        },
      )
      const response = await axios.post(
        `${this.serverUrl}/bundles`,
        {
          bundles,
        },
        {
          headers: {
            'x-api-key': this.apiKey,
          },
        },
      )

      return response.data.bundleResults.map((bundleResult: any) => {
        return {
          ...bundleResult,
          bundleId: BigInt(bundleResult.bundleId),
        }
      })
    } catch (error) {
      this.parseError(error)
      throw new Error('Failed to post order bundle')
    }
  }

  async getBundleStatus(bundleId: bigint): Promise<BundleResult> {
    try {
      const response = await axios.get(
        `${this.serverUrl}/bundles/${bundleId.toString()}`,
        {
          headers: {
            'x-api-key': this.apiKey,
          },
        },
      )

      response.data.claims = response.data.claims.map((claim: any) => {
        return {
          ...claim,
          depositId: BigInt(claim.depositId),
        }
      })

      return response.data
    } catch (error) {
      this.parseError(error)
      throw new Error('Failed to get bundle status')
    }
  }

  async getPendingBundles(
    count: number = 20,
    offset: number = 0,
  ): Promise<{ pendingBundles: BundleEvent[]; nextOffset?: number }> {
    try {
      const response = await axios.get(`${this.serverUrl}/bundles/events`, {
        params: {
          count,
          offset,
        },
        headers: {
          'x-api-key': this.apiKey,
        },
      })
      const { events: pendingBundles, nextOffset } = response.data

      return {
        pendingBundles: pendingBundles.map(parsePendingBundleEvent),
        nextOffset,
      }
    } catch (error) {
      this.parseError(error)
      throw new Error('Failed to get pending bundles')
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
        }
      } else {
        console.error(error)
      }
      throw new OrchestratorError({
        message: error.response.data.errors[0].message,
        context,
        errorType,
        traceId: context.traceId,
      })
    }
  }
}
