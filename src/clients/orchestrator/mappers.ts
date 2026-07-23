import type { Address, SignedAuthorization } from 'viem'
import {
  chainIdFromReference,
  formatCaip2,
  parseCaip2,
} from '../../chains/caip2'
import type {
  BridgeFill,
  ChainOperation,
  Cost,
  CostTokenEntry,
  TokenRequirements,
} from './public'
import type {
  OrchestratorIntentRequest,
  OrchestratorIntentStatus,
  OrchestratorPortfolio,
  OrchestratorQuote,
  OrchestratorQuoteResponse,
  OrchestratorSignedIntent,
  OrchestratorSplitRequest,
  OrchestratorSplitResult,
} from './types'
import type {
  WireIntentStatusResponse,
  WirePortfolioResponse,
  WireQuote,
  WireQuoteResponse,
  WireSplitResponse,
} from './wire'

export function mapIntentRequestToWire(
  input: OrchestratorIntentRequest,
): unknown {
  return serializeBigInts({
    account: input.account,
    destinationChainId: formatCaip2(input.destinationChainId),
    destinationExecutions: input.destinationExecutions,
    tokenRequests: input.tokenRequests,
    recipient: input.recipient,
    accountAccessList: mapAccessList(input.accountAccessList),
    options: {
      ...input.options,
      ...(input.options.auxiliaryFunds
        ? {
            auxiliaryFunds: mapChainRecord(input.options.auxiliaryFunds),
          }
        : {}),
    },
    ...(input.destinationGasUnits === undefined
      ? {}
      : { destinationGasLimit: input.destinationGasUnits }),
    ...(input.preClaimExecutions
      ? { preClaimExecutions: mapChainRecord(input.preClaimExecutions) }
      : {}),
  })
}

export function mapQuoteResponseFromWire(
  value: unknown,
): OrchestratorQuoteResponse {
  const input = value as WireQuoteResponse
  return {
    traceId: input.traceId ?? '',
    routes: (input.routes ?? []).map(mapQuoteFromWire),
  }
}

export function mapSignedIntentToWire(
  input: OrchestratorSignedIntent,
): unknown {
  return serializeBigInts({
    intentId: input.intentId,
    signatures: input.signatures,
    ...(input.authorizations
      ? {
          authorizations: {
            ...(input.authorizations.sponsor
              ? {
                  sponsor: input.authorizations.sponsor.map(
                    mapAuthorizationToWire,
                  ),
                }
              : {}),
            ...(input.authorizations.recipient
              ? {
                  recipient: input.authorizations.recipient.map(
                    mapAuthorizationToWire,
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(input.dryRun ? { options: { dryRun: true } } : {}),
  })
}

export function mapIntentStatusFromWire(
  intentId: string,
  value: unknown,
): OrchestratorIntentStatus {
  const input = value as WireIntentStatusResponse & {
    readonly accountAddress?: Address
    readonly operations?: readonly {
      readonly chain?: string | number
      readonly items?: readonly unknown[]
    }[]
  }
  return {
    traceId: input.traceId ?? '',
    intentId,
    status: input.status,
    account:
      input.accountAddress ??
      ('0x0000000000000000000000000000000000000000' as Address),
    operations: (input.operations ?? []).map(
      (operation) =>
        ({
          chain: parseChainValue(operation.chain),
          ...((operation.items?.[0] as Record<string, unknown> | undefined) ??
            {}),
        }) as ChainOperation,
    ),
  }
}

export function mapPortfolioFromWire(value: unknown): OrchestratorPortfolio {
  const input = value as WirePortfolioResponse & {
    readonly portfolio?: readonly {
      readonly symbol: string
      readonly chains: readonly {
        readonly chainId: string | number
        readonly address: Address
        readonly decimals: number
        readonly amount: string | number | bigint
      }[]
    }[]
  }
  return {
    tokens: (input.portfolio ?? []).map((token) => ({
      symbol: token.symbol,
      chains: token.chains.map((chain) => ({
        chain: parseChainValue(chain.chainId),
        address: chain.address as Address,
        decimals: chain.decimals,
        amount: BigInt(chain.amount),
      })),
    })),
  }
}

export function mapSplitRequestToWire(
  input: OrchestratorSplitRequest,
): unknown {
  return serializeBigInts({
    chainId: formatCaip2(input.chainId),
    tokens: input.tokens,
    settlementLayers: input.settlementLayers,
  })
}

export function mapSplitResultFromWire(
  value: unknown,
): OrchestratorSplitResult {
  const input = value as WireSplitResponse & {
    readonly intents?: readonly Record<Address, string | number | bigint>[]
  }
  return {
    traceId: input.traceId ?? '',
    intents: (input.intents ?? []).map(
      (intent) =>
        Object.fromEntries(
          Object.entries(intent).map(([token, amount]) => [
            token,
            BigInt(amount),
          ]),
        ) as Record<Address, bigint>,
    ),
  }
}

function mapQuoteFromWire(value: WireQuote): OrchestratorQuote {
  return {
    intentId: value.intentId,
    expiresAt: value.expiresAt,
    estimatedFillTime: value.estimatedFillTime,
    settlementLayer: value.settlementLayer,
    signData: value.signData as unknown as OrchestratorQuote['signData'],
    cost: mapCostFromWire(value.cost),
    ...(value.tokenRequirements === undefined
      ? {}
      : {
          tokenRequirements: mapTokenRequirementsFromWire(
            value.tokenRequirements,
          ),
        }),
    ...(value.bridgeFill === undefined
      ? {}
      : { bridgeFill: mapBridgeFillFromWire(value.bridgeFill) }),
  }
}

function mapCostFromWire(value: WireQuote['cost']): Cost {
  return {
    input: value.input.map(mapCostTokenFromWire),
    output: value.output.map(mapCostTokenFromWire),
    fees: value.fees,
  }
}

function mapCostTokenFromWire(
  value: WireQuote['cost']['input'][number],
): CostTokenEntry {
  return {
    chainId: parseChainValue(value.chainId),
    tokenAddress: value.tokenAddress as Address,
    symbol: value.symbol,
    decimals: value.decimals,
    price: value.price,
    amount: BigInt(value.amount),
  }
}

function mapTokenRequirementsFromWire(
  value: NonNullable<WireQuote['tokenRequirements']>,
): TokenRequirements {
  return Object.fromEntries(
    Object.entries(value).map(([chainId, tokens]) => [
      parseChainValue(chainId),
      Object.fromEntries(
        Object.entries(tokens).map(([token, requirement]) => [
          token,
          { ...requirement, amount: BigInt(requirement.amount) },
        ]),
      ),
    ]),
  ) as TokenRequirements
}

function mapBridgeFillFromWire(
  value: NonNullable<WireQuote['bridgeFill']>,
): BridgeFill {
  const { fillStatusTimeout: _ignored, ...bridgeFill } = value
  return bridgeFill as BridgeFill
}

function mapAuthorizationToWire(authorization: SignedAuthorization): unknown {
  return {
    chainId: formatCaip2(authorization.chainId),
    address: authorization.address,
    nonce: authorization.nonce,
    yParity: authorization.yParity ?? 0,
    r: authorization.r,
    s: authorization.s,
  }
}

function mapAccessList(
  input: OrchestratorIntentRequest['accountAccessList'],
): unknown {
  if (!input) return undefined
  return {
    ...(input.chainIds ? { chainIds: input.chainIds.map(formatCaip2) } : {}),
    ...(input.tokens ? { tokens: input.tokens } : {}),
    ...(input.chainTokens
      ? { chainTokens: mapChainRecord(input.chainTokens) }
      : {}),
    ...(input.chainTokenAmounts
      ? { chainTokenAmounts: mapChainRecord(input.chainTokenAmounts) }
      : {}),
  }
}

function mapChainRecord<T>(
  input: Readonly<Record<number, T>>,
): Readonly<Record<string, T>> {
  return Object.fromEntries(
    Object.entries(input).map(([chainId, value]) => [
      formatCaip2(Number(chainId)),
      value,
    ]),
  )
}

function parseChainValue(value: string | number | undefined): number {
  if (typeof value === 'number') return value
  if (value === undefined) throw new Error('Orchestrator chain id is missing')
  if (/^\d+$/u.test(value)) return Number(value)
  return chainIdFromReference(parseCaip2(value))
}

function serializeBigInts(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(serializeBigInts)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeBigInts(item)]),
    )
  }
  return value
}
