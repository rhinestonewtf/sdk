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
  SplitIntentsInput,
  SplitIntentsResult,
  TokenRequirements,
} from './types'
import { convertBigIntFields } from './utils'

interface PolicyContext {
  intentInput: unknown
  isSponsored: boolean
}

type ChainIdInput = string | number

type AppFeeResponse = {
  feeBps: number
  baseAmount: string | number | bigint
  amount: string | number | bigint
  chainId: ChainIdInput
  tokenAddress: Address
}

type AlpsTokenBalance = {
  locked?: string | number | bigint
  unlocked?: string | number | bigint
}

type AlpsIntentCost =
  | {
      hasFulfilledAll: true
      tokensSpent?: Record<string, Record<Address, AlpsTokenBalance>>
      tokensReceived?: Array<{
        tokenAddress: Address
        destinationAmount: string | number | bigint
      }>
      appFee?: AppFeeResponse[]
      gasCost?: { destination?: { chainId?: ChainIdInput } }
      feeBreakdownUSD?: {
        gasFeeUSD?: number
        bridgeFeeUSD?: number
        swapFeeUSD?: number
        settlementFeeUSD?: number
        appFeeUSD?: number
      }
    }
  | {
      hasFulfilledAll: false
      totalTokenShortfallInUSD?: number
    }

type AlpsSettlementContext = {
  settlementLayer?: Quote['settlementLayer']
  bridgeFill?: { type: Quote['settlementLayer'] }
}

type AlpsIntentOp = {
  nonce: string | number | bigint
  expires: string | number | bigint
  signData?: Quote['signData']
  bridgeFill?: BridgeFill
  elements?: Array<{
    mandate?: {
      qualifier?: {
        settlementContext?: AlpsSettlementContext
      }
    }
  }>
}

type AlpsQuoteResponse = {
  traceId?: string
  intentOp: AlpsIntentOp
  intentCost: AlpsIntentCost
  estimatedFillTimeSec?: number
  tokenRequirements?: unknown
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
    const json = await this.fetch(url.toString(), {
      headers: await this.getHeaders(),
    })
    const portfolioWire = json.portfolio as Array<{
      symbol: string
      chains: Array<{
        chainId: string | number
        address: Address
        decimals: number
        amount: string
      }>
    }>
    return portfolioWire.map((token) => ({
      symbol: token.symbol,
      chains: token.chains.map((c) => ({
        chain: parseChainId(c.chainId),
        address: c.address,
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
    const json = await this.fetch(`${this.serverUrl}/intents/splits`, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify(body),
    })
    return {
      traceId: json.traceId,
      intents: (json.intents as Record<string, string>[]).map(
        parseTokenAmountsRecord,
      ),
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
    const json = await this.fetch(`${this.serverUrl}/intents/${intentId}`, {
      headers: await this.getHeaders(),
    })
    return {
      traceId: json.traceId,
      status: json.status,
      accountAddress: json.accountAddress,
      // Flatten orchestrator's per-chain items[] to one entry per chain.
      operations: (json.operations ?? []).map((op: any) => {
        const item = op.items?.[0] ?? {}
        return { chain: op.chain, ...item }
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

function decodeQuoteResponse(json: any): QuoteResponse {
  if (!Array.isArray(json.routes) && json.intentOp && json.intentCost) {
    return {
      traceId: json.traceId,
      routes: [decodeAlpsQuote(json as AlpsQuoteResponse)],
    }
  }

  const routes = (json.routes ?? []) as any[]
  return { traceId: json.traceId, routes: routes.map(decodeQuote) }
}

function decodeAlpsQuote(response: AlpsQuoteResponse): Quote {
  const intentOp = response.intentOp
  return {
    intentId: String(intentOp.nonce),
    expiresAt: Number(intentOp.expires),
    estimatedFillTime: { seconds: response.estimatedFillTimeSec ?? 0 },
    settlementLayer: decodeAlpsSettlementLayer(intentOp),
    signData:
      intentOp.signData ??
      ({ origin: [], destination: undefined } as unknown as Quote['signData']),
    cost: decodeAlpsCost(response.intentCost),
    appFee: response.intentCost.hasFulfilledAll
      ? decodeAppFee(response.intentCost.appFee)
      : undefined,
    tokenRequirements: response.tokenRequirements
      ? decodeTokenRequirements(response.tokenRequirements)
      : undefined,
    bridgeFill: decodeBridgeFill(intentOp.bridgeFill),
  }
}

function decodeAlpsSettlementLayer(
  intentOp: AlpsIntentOp,
): Quote['settlementLayer'] {
  const context = intentOp.elements?.find?.((element) => {
    const ctx = element?.mandate?.qualifier?.settlementContext
    return ctx?.bridgeFill
  })?.mandate?.qualifier?.settlementContext

  const firstContext =
    context ?? intentOp.elements?.[0]?.mandate?.qualifier?.settlementContext

  if (
    firstContext?.settlementLayer === 'INTENT_EXECUTOR' &&
    firstContext.bridgeFill
  ) {
    return firstContext.bridgeFill.type
  }

  return firstContext?.settlementLayer ?? 'INTENT_EXECUTOR'
}

function decodeAlpsCost(intentCost: AlpsIntentCost): Cost {
  if (!intentCost.hasFulfilledAll) {
    return {
      input: [],
      output: [],
      fees: {
        total: { usd: intentCost.totalTokenShortfallInUSD ?? 0 },
        breakdown: {
          gas: { usd: 0 },
          bridge: { usd: 0 },
          swap: { usd: 0 },
          app: { usd: 0 },
        },
      },
    }
  }

  const breakdown = intentCost.feeBreakdownUSD ?? {}
  const gasUSD = breakdown.gasFeeUSD ?? 0
  const bridgeUSD = breakdown.settlementFeeUSD ?? breakdown.bridgeFeeUSD ?? 0
  const swapUSD = breakdown.swapFeeUSD ?? 0
  const appUSD = breakdown.appFeeUSD ?? 0

  return {
    input: decodeAlpsInputEntries(intentCost.tokensSpent),
    output: decodeAlpsOutputEntries(intentCost),
    fees: {
      total: { usd: gasUSD + bridgeUSD + swapUSD + appUSD },
      breakdown: {
        gas: { usd: gasUSD },
        bridge: { usd: bridgeUSD },
        swap: { usd: swapUSD },
        app: { usd: appUSD },
      },
    },
  }
}

function decodeAlpsInputEntries(
  tokensSpent: Extract<
    AlpsIntentCost,
    { hasFulfilledAll: true }
  >['tokensSpent'],
): CostTokenEntry[] {
  const entries: CostTokenEntry[] = []
  for (const [chainKey, perToken] of Object.entries(tokensSpent ?? {})) {
    const chainId = parseChainId(chainKey)
    for (const [tokenAddress, tokenBalance] of Object.entries(perToken)) {
      entries.push({
        chainId,
        tokenAddress: tokenAddress as Address,
        symbol: null,
        decimals: null,
        price: null,
        amount:
          BigInt(tokenBalance.locked ?? 0) + BigInt(tokenBalance.unlocked ?? 0),
      })
    }
  }
  return entries
}

function decodeAlpsOutputEntries(
  intentCost: Extract<AlpsIntentCost, { hasFulfilledAll: true }>,
): CostTokenEntry[] {
  const destinationChainId = parseChainId(
    intentCost.gasCost?.destination?.chainId ?? 0,
  )
  const byToken = new Map<Address, bigint>()
  for (const entry of intentCost.tokensReceived ?? []) {
    const tokenAddress = entry.tokenAddress as Address
    byToken.set(
      tokenAddress,
      (byToken.get(tokenAddress) ?? 0n) + BigInt(entry.destinationAmount),
    )
  }

  return [...byToken.entries()].map(([tokenAddress, amount]) => ({
    chainId: destinationChainId,
    tokenAddress,
    symbol: null,
    decimals: null,
    price: null,
    amount,
  }))
}

function decodeQuote(route: any): Quote {
  return {
    intentId: route.intentId,
    expiresAt: route.expiresAt,
    estimatedFillTime: route.estimatedFillTime,
    settlementLayer: route.settlementLayer,
    signData: route.signData,
    cost: decodeCost(route.cost),
    appFee: decodeAppFee(route.appFee ?? route.intentCost?.appFee),
    tokenRequirements: route.tokenRequirements
      ? decodeTokenRequirements(route.tokenRequirements)
      : undefined,
    bridgeFill: decodeBridgeFill(route.bridgeFill),
  }
}

function decodeAppFee(
  appFee: AppFeeResponse[] | undefined,
): AppFee[] | undefined {
  if (!appFee) return undefined
  return appFee.map((fee) => ({
    feeBps: fee.feeBps,
    baseAmount: BigInt(fee.baseAmount),
    amount: BigInt(fee.amount),
    chainId: parseChainId(fee.chainId),
    tokenAddress: fee.tokenAddress,
  }))
}

// Normalizes CAIP-2 strings to numeric IDs for consistency with BridgeFill decodeCostTokenEntry, and getIntent
function decodeBridgeFill(bf: any): BridgeFill | undefined {
  if (!bf) return undefined
  return { ...bf, destinationChainId: parseChainId(bf.destinationChainId) }
}

function decodeCost(cost: any): Cost {
  return {
    input: (cost.input as any[]).map(decodeCostTokenEntry),
    output: (cost.output as any[]).map(decodeCostTokenEntry),
    fees: cost.fees,
  }
}

function decodeCostTokenEntry(entry: any): CostTokenEntry {
  return {
    chainId: parseChainId(entry.chainId),
    tokenAddress: entry.tokenAddress,
    symbol: entry.symbol,
    decimals: entry.decimals,
    price: entry.price,
    amount: BigInt(entry.amount),
  }
}

function decodeTokenRequirements(wire: any): TokenRequirements {
  const out: TokenRequirements = {}
  for (const [chainKey, tokens] of Object.entries(wire)) {
    const chainId = parseChainId(chainKey)
    out[chainId] = {} as TokenRequirements[number]
    for (const [tokenAddress, requirement] of Object.entries(
      tokens as Record<string, any>,
    )) {
      out[chainId][tokenAddress as Address] = {
        ...requirement,
        amount: BigInt(requirement.amount),
      }
    }
  }
  return out
}
