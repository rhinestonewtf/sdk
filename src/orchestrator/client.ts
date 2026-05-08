import type { Address } from 'viem'
import type { AuthProvider } from '../auth/provider'
import { fromCaip2, toCaip2 } from './caip2'
import { API_VERSION, SDK_VERSION } from './consts'
import {
  type ErrorEnvelope,
  OrchestratorError,
  parseErrorEnvelope,
} from './error'
import type {
  AccountAccessList,
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
  SettlementLayerFilter,
  SplitIntentsInput,
  SplitIntentsResult,
  TokenRequirements,
} from './types'
import { convertBigIntFields } from './utils'

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
      settlementLayers: input.settlementLayers
        ? encodeSettlementLayers(input.settlementLayers)
        : undefined,
    })
    const json = await this.fetch(`${this.serverUrl}/intents/splits`, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify(body),
    })
    return {
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
      status: json.status,
      claims: (json.claims ?? []).map((claim: any) => ({
        depositId: claim.depositId !== undefined ? BigInt(claim.depositId) : 0n,
        chainId: parseChainId(claim.chainId),
        status: claim.status,
        claimTimestamp: claim.claimTimestamp,
        claimTransactionHash: claim.claimTransactionHash,
      })),
      destinationChainId: parseChainId(json.destinationChainId),
      accountAddress: json.accountAddress,
      fillTimestamp: json.fillTimestamp,
      fillTransactionHash: json.fillTransactionHash,
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
      const retryAfter = response.headers?.get?.('retry-after') ?? undefined
      throw parseErrorEnvelope(
        body as ErrorEnvelope,
        response.status,
        retryAfter ?? undefined,
      )
    }

    return response.json()
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
    if (value.startsWith('eip155:')) return fromCaip2(value)
    return Number(value)
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
  if (options.settlementLayers) {
    wire.settlementLayers = encodeSettlementLayers(options.settlementLayers)
  }
  return wire
}

// Inversion universe for `{ exclude }`. Drop once the orchestrator accepts the
// union natively; RHINO/CCTP are listed despite not being in `SettlementLayer`.
const KNOWN_SETTLEMENT_LAYERS = [
  'ACROSS',
  'ECO',
  'RELAY',
  'OFT',
  'NEAR',
  'RHINO',
  'CCTP',
] as const

export function encodeSettlementLayers(
  filter: SettlementLayerFilter,
): readonly string[] {
  if ('include' in filter) return filter.include
  const excluded = new Set<string>(filter.exclude)
  return KNOWN_SETTLEMENT_LAYERS.filter((layer) => !excluded.has(layer))
}

function decodeQuoteResponse(json: any): QuoteResponse {
  const routes = (json.routes ?? []) as any[]
  return { routes: routes.map(decodeQuote) }
}

function decodeQuote(route: any): Quote {
  return {
    intentId: route.intentId,
    expiresAt: route.expiresAt,
    estimatedFillTime: route.estimatedFillTime,
    settlementLayer: route.settlementLayer,
    signData: route.signData,
    cost: decodeCost(route.cost),
    tokenRequirements: route.tokenRequirements
      ? decodeTokenRequirements(route.tokenRequirements)
      : undefined,
    bridgeFill: decodeBridgeFill(route.bridgeFill),
  }
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
