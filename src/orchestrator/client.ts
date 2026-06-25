import type { Address } from 'viem'
import type { AuthProvider } from '../auth/provider'
import { fromCaip2, isCaip2, toCaip2 } from './caip2'
import { API_VERSION, SDK_VERSION } from './consts'
import {
  type ErrorEnvelope,
  OrchestratorError,
  parseErrorEnvelope,
} from './error'
import type {
  AccountAccessList,
  AppFee,
  ApprovalRequired,
  AuxiliaryFunds,
  BridgeFill,
  Cost,
  CostTokenEntry,
  IntentInput,
  IntentOpStatus,
  IntentOptions,
  IntentSubmitRequestInternal,
  IntentSubmitResponse,
  Portfolio,
  Quote,
  QuoteResponse,
  SignData,
  SplitIntentsInput,
  SplitIntentsResult,
  TokenRequirements,
  WrapRequired,
} from './types'
import { convertBigIntFields } from './utils'
import type {
  WireBridgeFill,
  WireCost,
  WireCostInputEntry,
  WireCostOutputEntry,
  WireIntentStatus,
  WirePortfolioResponse,
  WireQuoteResponse,
  WireRoute,
  WireSplitResponse,
  WireTokenRequirements,
} from './wire'

/** Body shape returned by {@link Orchestrator.fetch}: the wire body plus the
 * `x-trace-id` header folded in. */
type WithTraceId<T> = T & { traceId?: string }

interface PolicyContext {
  intentInput: unknown
  isSponsored: boolean
}

export class Orchestrator {
  private serverUrl: string
  private authProvider: AuthProvider
  private extraHeaders?: Record<string, string>

  constructor(
    serverUrl: string,
    authProvider: AuthProvider,
    headers?: Record<string, string>,
  ) {
    this.serverUrl = serverUrl
    this.authProvider = authProvider
    this.extraHeaders = headers
  }

  async getPortfolio(
    accountAddress: Address,
    filter?: {
      chainIds?: number[]
      tokens?: { [chainId: number]: Address[] }
    },
  ): Promise<Portfolio> {
    const params = new URLSearchParams()
    if (filter?.chainIds) {
      for (const id of filter.chainIds) {
        params.append('chainIds', toCaip2(id))
      }
    }
    if (filter?.tokens) {
      for (const [chainId, tokens] of Object.entries(filter.tokens)) {
        for (const token of tokens) {
          params.append('tokens', `${toCaip2(Number(chainId))}:${token}`)
        }
      }
    }
    const url = new URL(
      `${this.serverUrl}/accounts/${accountAddress}/portfolio`,
    )
    url.search = params.toString()
    const json: WirePortfolioResponse = await this.fetch(url.toString(), {
      headers: await this.getHeaders(),
    })
    const portfolioWire = json.portfolio
    return portfolioWire.map((token) => ({
      symbol: token.symbol,
      chains: token.chains.map((c) => ({
        chain: parseChainId(c.chainId),
        address: c.address as Address,
        decimals: c.decimals,
        amount: BigInt(c.amount),
      })),
    }))
  }

  async createQuote(input: IntentInput): Promise<QuoteResponse> {
    const body = encodeIntentInput(input)
    const json = await this.fetch(`${this.serverUrl}/quotes`, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify(body),
    })
    return decodeQuoteResponse(json)
  }

  async getSplit(input: SplitIntentsInput): Promise<SplitIntentsResult> {
    const body = convertBigIntFields({
      chainId: toCaip2(input.chain.id),
      tokens: input.tokens,
      settlementLayers: input.settlementLayers,
    })
    const json: WithTraceId<WireSplitResponse> = await this.fetch(
      `${this.serverUrl}/intents/splits`,
      {
        method: 'POST',
        headers: await this.getHeaders(),
        body: JSON.stringify(body),
      },
    )
    return {
      traceId: json.traceId ?? '',
      intents: json.intents.map(parseTokenAmountsRecord),
    }
  }

  async createIntent(
    request: IntentSubmitRequestInternal,
    policyContext?: PolicyContext,
  ): Promise<IntentSubmitResponse> {
    const body = convertBigIntFields(request)
    const headers = policyContext
      ? await this.getSubmitHeaders(
          policyContext.intentInput,
          policyContext.isSponsored,
        )
      : await this.getHeaders()
    return await this.fetch(`${this.serverUrl}/intents`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  }

  async getIntent(intentId: string): Promise<IntentOpStatus> {
    const json: WithTraceId<WireIntentStatus> = await this.fetch(
      `${this.serverUrl}/intents/${intentId}`,
      {
        headers: await this.getHeaders(),
      },
    )
    return {
      traceId: json.traceId ?? '',
      status: json.status,
      accountAddress: json.accountAddress as Address,
      // Flatten orchestrator's per-chain items[] to one entry per chain.
      operations: (json.operations ?? []).map((op) => {
        const item = op.items?.[0]
        return {
          chain: op.chain,
          ...item,
        } as IntentOpStatus['operations'][number]
      }),
    }
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const auth = await this.authProvider.getHeaders()
    return {
      'Content-Type': 'application/json',
      'x-sdk-version': SDK_VERSION,
      'x-api-version': API_VERSION,
      ...auth,
      ...this.extraHeaders,
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
      'x-api-version': API_VERSION,
      ...auth,
      ...this.extraHeaders,
    }
  }

  private async fetch(url: string, options?: RequestInit): Promise<any> {
    const response = await fetch(url, options)
    const traceId = response.headers?.get?.('x-trace-id') ?? undefined

    if (!response.ok) {
      let body: any
      try {
        body = await response.json()
      } catch {
        body = {
          code: 'INTERNAL_ERROR',
          message: `Request failed with status ${response.status}`,
          traceId: '',
        }
      }
      body = { ...body, traceId: traceId ?? body.traceId ?? '' }
      const retryAfter = response.headers?.get?.('retry-after') ?? undefined
      throw parseErrorEnvelope(
        body as ErrorEnvelope,
        response.status,
        retryAfter ?? undefined,
      )
    }

    const body = await response.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return { ...body, traceId: traceId ?? body.traceId }
    }
    return body
  }
}

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

function parseChainId(value: string | number): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    if (isCaip2(value)) return fromCaip2(value)
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
  }
  throw new OrchestratorError({
    message: `Invalid chain id value: ${String(value)}`,
  })
}

function encodeIntentInput(input: IntentInput): unknown {
  const {
    account,
    destinationChainId,
    destinationExecutions,
    destinationGasUnits,
    tokenRequests,
    recipient,
    accountAccessList,
    options,
    preClaimExecutions,
  } = input

  const wire: Record<string, unknown> = {
    account,
    destinationChainId: toCaip2(destinationChainId),
    destinationExecutions,
    tokenRequests,
    recipient,
    accountAccessList: encodeAccountAccessList(accountAccessList),
    options: encodeOptions(options),
  }

  if (destinationGasUnits !== undefined) {
    wire.destinationGasLimit = destinationGasUnits
  }

  if (preClaimExecutions) {
    wire.preClaimExecutions = Object.fromEntries(
      Object.entries(preClaimExecutions).map(([chainId, ops]) => [
        toCaip2(Number(chainId)),
        ops,
      ]),
    )
  }

  return convertBigIntFields(wire)
}

function encodeAccountAccessList(list: AccountAccessList | undefined): unknown {
  if (!list) return undefined
  const out: Record<string, unknown> = {}
  if ('chainIds' in list && list.chainIds) {
    out.chainIds = list.chainIds.map(toCaip2)
  }
  if ('tokens' in list && list.tokens) {
    out.tokens = list.tokens
  }
  if ('chainTokens' in list && list.chainTokens) {
    out.chainTokens = Object.fromEntries(
      Object.entries(list.chainTokens).map(([chainId, tokens]) => [
        toCaip2(Number(chainId)),
        tokens,
      ]),
    )
  }
  if ('chainTokenAmounts' in list && list.chainTokenAmounts) {
    out.chainTokenAmounts = Object.fromEntries(
      Object.entries(list.chainTokenAmounts).map(([chainId, tokens]) => [
        toCaip2(Number(chainId)),
        tokens,
      ]),
    )
  }
  return out
}

function encodeAuxiliaryFunds(funds: AuxiliaryFunds): AuxiliaryFunds {
  return Object.fromEntries(
    Object.entries(funds).map(([chainId, balances]) => [
      toCaip2(Number(chainId)),
      balances,
    ]),
  ) as AuxiliaryFunds
}

function encodeOptions(options: IntentOptions): Record<string, unknown> {
  const wire: Record<string, unknown> = { ...options }
  if (options.auxiliaryFunds) {
    wire.auxiliaryFunds = encodeAuxiliaryFunds(options.auxiliaryFunds)
  }
  return wire
}

function decodeQuoteResponse(
  json: WithTraceId<WireQuoteResponse>,
): QuoteResponse {
  return {
    traceId: json.traceId ?? '',
    routes: (json.routes ?? []).map(decodeQuote),
  }
}

function decodeQuote(route: WireRoute): Quote {
  return {
    intentId: route.intentId,
    expiresAt: route.expiresAt,
    estimatedFillTime: route.estimatedFillTime,
    settlementLayer: route.settlementLayer,
    signData: route.signData as unknown as SignData,
    cost: decodeCost(route.cost),
    appFee: decodeAppFee(route.appFee),
    tokenRequirements: route.tokenRequirements
      ? decodeTokenRequirements(route.tokenRequirements)
      : undefined,
    bridgeFill: decodeBridgeFill(route.bridgeFill),
  }
}

function decodeAppFee(appFee: WireRoute['appFee']): AppFee[] | undefined {
  if (!appFee) return undefined
  return appFee.map((fee) => ({
    feeBps: fee.feeBps,
    baseAmount: BigInt(fee.baseAmount),
    amount: BigInt(fee.amount),
    chainId: parseChainId(fee.chainId),
    tokenAddress: fee.tokenAddress as Address,
  }))
}

function decodeBridgeFill(
  bf: WireBridgeFill | undefined,
): BridgeFill | undefined {
  if (!bf) return undefined
  return { ...bf } as BridgeFill
}

function decodeCost(cost: WireCost): Cost {
  return {
    input: cost.input.map(decodeCostTokenEntry),
    output: cost.output.map(decodeCostTokenEntry),
    fees: cost.fees,
  }
}

function decodeCostTokenEntry(
  entry: WireCostInputEntry | WireCostOutputEntry,
): CostTokenEntry {
  return {
    chainId: parseChainId(entry.chainId),
    tokenAddress: entry.tokenAddress as Address,
    symbol: entry.symbol,
    decimals: entry.decimals,
    price: entry.price,
    amount: BigInt(entry.amount),
  }
}

function decodeTokenRequirements(
  wire: WireTokenRequirements,
): TokenRequirements {
  const out: TokenRequirements = {}
  for (const [chainKey, tokens] of Object.entries(wire)) {
    const chainId = parseChainId(chainKey)
    out[chainId] = {} as TokenRequirements[number]
    for (const [tokenAddress, requirement] of Object.entries(tokens)) {
      out[chainId][tokenAddress as Address] = {
        ...requirement,
        amount: BigInt(requirement.amount),
      } as ApprovalRequired | WrapRequired
    }
  }
  return out
}
