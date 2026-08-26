import type { Address, Hex, SignedAuthorization } from 'viem'
import {
  chainIdFromReference,
  formatCaip2,
  isHyperCoreWireId,
  isNonEvmChainId,
  parseCaip2,
} from '../../chains/caip2'
import type {
  BridgeFill,
  ChainOperation,
  Cost,
  CostTokenEntry,
  TokenRequirements,
} from './public'
import { serializeBigInts } from './serialization'
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
  WireIntentRequest,
  WireIntentRequestInternal,
  WireIntentStatusResponse,
  WirePortfolioResponse,
  WireQuote,
  WireQuoteRequest,
  WireQuoteResponse,
  WireSplitRequest,
  WireSplitResponse,
} from './wire'

export function mapIntentRequestToWire(
  input: OrchestratorIntentRequest,
): WireQuoteRequest {
  return serializeBigInts({
    account: input.account,
    destinationChainId: formatCaip2(input.destinationChainId),
    destinationExecutions: input.destinationExecutions,
    tokenRequests: input.tokenRequests,
    recipient: input.recipient,
    accountAccessList: mapAccessList(input.accountAccessList),
    options: {
      ...input.options,
      settlementLayers: mapSettlementLayers(input.options.settlementLayers),
      signatureMode: input.options.signatureMode as
        | NonNullable<WireQuoteRequest['options']>['signatureMode']
        | undefined,
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
): WireIntentRequestInternal {
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
): WireSplitRequest {
  return serializeBigInts({
    chainId: formatCaip2(input.chainId),
    tokens: input.tokens,
    settlementLayers: mapSettlementLayers(input.settlementLayers),
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
  switch (value.type) {
    case 'OFT':
      return {
        type: 'OFT',
        destinationChainId: value.destinationChainId,
      }
    case 'ECO':
      return {
        type: 'ECO',
        destinationChainId: value.destinationChainId,
        intentHash: value.intentHash as Hex,
      }
    case 'RELAY':
      return {
        type: 'RELAY',
        destinationChainId: value.destinationChainId,
        requestId: value.requestId,
      }
    case 'NEAR':
      return {
        type: 'NEAR',
        destinationChainId: value.destinationChainId,
        depositAddress: value.depositAddress as Address,
      }
    case 'RHINO':
      return {
        type: 'RHINO',
        destinationChainId: value.destinationChainId,
        commitmentId: value.commitmentId,
      }
    case 'CCTP':
      return {
        type: 'CCTP',
        destinationChainId: value.destinationChainId,
        sourceDomainId: value.sourceDomainId,
        destinationDomainId: value.destinationDomainId,
      }
    default:
      throw new Error(
        `Unsupported bridge fill type from orchestrator: ${String((value as { readonly type?: unknown }).type)}`,
      )
  }
}

type WireAuthorization = NonNullable<
  NonNullable<WireIntentRequest['authorizations']>['sponsor']
>[number]

function mapAuthorizationToWire(
  authorization: SignedAuthorization,
): WireAuthorization {
  return {
    chainId: mapAuthorizationChainIdToWire(authorization.chainId),
    address: authorization.address,
    nonce: authorization.nonce,
    yParity: authorization.yParity ?? 0,
    r: authorization.r,
    s: authorization.s,
  }
}

function mapAuthorizationChainIdToWire(
  chainId: number,
): 0 | `eip155:${number}` {
  if (chainId === 0) return 0
  if (
    !Number.isSafeInteger(chainId) ||
    chainId < 0 ||
    isHyperCoreWireId(chainId) ||
    isNonEvmChainId(chainId)
  ) {
    throw new Error(`Invalid EIP-7702 authorization chain ID: ${chainId}`)
  }
  return `eip155:${chainId}`
}

function mapAccessList(input: OrchestratorIntentRequest['accountAccessList']) {
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

function mapSettlementLayers(
  input:
    | OrchestratorIntentRequest['options']['settlementLayers']
    | OrchestratorSplitRequest['settlementLayers'],
): NonNullable<WireQuoteRequest['options']>['settlementLayers'] {
  // Keep the legacy public string arrays while checking the rest of the wire shape.
  return input as NonNullable<WireQuoteRequest['options']>['settlementLayers']
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
