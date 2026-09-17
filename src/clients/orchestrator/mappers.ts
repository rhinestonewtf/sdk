import type {
  Address,
  Hex,
  SignedAuthorization,
  TypedDataDefinition,
} from 'viem'
import {
  chainIdFromReference,
  formatCaip2,
  isHyperCoreWireId,
  isNonEvmChainId,
  parseCaip2,
} from '../../chains/caip2'
import { ValidationError } from './errors'
import type {
  BridgeFill,
  ChainOperation,
  Cost,
  CostTokenEntry,
  OriginSignData,
  SignData,
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
    ...(input.destinationInstructions
      ? { destinationInstructions: input.destinationInstructions }
      : {}),
    ...(input.addressLookupTableAddresses
      ? { addressLookupTableAddresses: input.addressLookupTableAddresses }
      : {}),
    accountAccessList: mapAccessList(input.accountAccessList),
    options: {
      ...input.options,
      settlementLayers: mapSettlementLayers(input.options.settlementLayers),
      quoters: mapQuoters(input.options.quoters),
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
    signatures: {
      origin: input.signatures.origin,
      ...(input.signatures.destination === undefined
        ? {}
        : { destination: input.signatures.destination }),
      ...(input.signatures.targetExecution === undefined
        ? {}
        : { targetExecution: input.signatures.targetExecution }),
    },
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
    readonly refunds?: readonly {
      readonly chain?: string | number
      readonly txHash: string
    }[]
    readonly hyperCore?: OrchestratorIntentStatus['hyperCore']
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
    // Deliberately NOT `?? []`, unlike every field above it. The orchestrator
    // omits the key when it knows of no refund, and that is not the same fact
    // as "there were none" — a refund is recorded only where a settlement layer
    // evidences it with a transaction. Defaulting would turn "we don't know"
    // into "the funds were kept", which is the one reading the wire contract
    // exists to prevent.
    ...(input.refunds
      ? {
          refunds: input.refunds.map((refund) => ({
            chain: parseChainValue(refund.chain),
            txHash: refund.txHash,
          })),
        }
      : {}),
    ...(input.hyperCore
      ? {
          hyperCore: {
            outcome: input.hyperCore.outcome,
            ...(input.hyperCore.reason === undefined
              ? {}
              : { reason: input.hyperCore.reason }),
          },
        }
      : {}),
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

function malformedSignData(message: string): never {
  throw new ValidationError({ message })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function supportedTypedData(
  value: unknown,
  options: { tagged: boolean },
): TypedDataDefinition {
  if (!isObject(value)) {
    return malformedSignData(
      'The orchestrator returned malformed EIP-712 intent signing data.',
    )
  }
  if (
    (options.tagged && value.kind !== 'eip712') ||
    (!options.tagged && value.kind !== undefined) ||
    !isObject(value.domain) ||
    !isObject(value.types) ||
    typeof value.primaryType !== 'string' ||
    !isObject(value.message)
  ) {
    return malformedSignData(
      options.tagged
        ? 'The orchestrator returned an invalid EIP-712 origin signing payload.'
        : 'The orchestrator returned an invalid untagged EIP-712 destination signing payload.',
    )
  }
  return value as TypedDataDefinition
}

function supportedOriginSignData(value: unknown): OriginSignData {
  if (!isObject(value)) {
    return malformedSignData(
      'The orchestrator returned malformed origin intent signing data.',
    )
  }

  if (value.kind === 'personalSign') {
    if (
      typeof value.message !== 'string' ||
      !/^[0-9a-fA-F]{64}$/u.test(value.message) ||
      typeof value.expiresAtSlot !== 'string' ||
      !/^\d+$/u.test(value.expiresAtSlot)
    ) {
      return malformedSignData(
        'The orchestrator returned an invalid personal-sign origin payload; expected a 64-character hex message and decimal expiresAtSlot.',
      )
    }
    return {
      kind: 'personalSign',
      message: value.message,
      expiresAtSlot: value.expiresAtSlot,
    }
  }

  if (value.kind === undefined || value.kind === 'eip712') {
    const typedData = supportedTypedData(
      value.kind === undefined ? { ...value, kind: 'eip712' } : value,
      { tagged: true },
    )
    return typedData as OriginSignData
  }

  return malformedSignData(
    `The orchestrator returned an unsupported origin signing scheme: ${String(value.kind)}.`,
  )
}

export function mapSupportedSignData(value: unknown): SignData {
  if (!isObject(value) || !Array.isArray(value.origin)) {
    return malformedSignData(
      'The orchestrator returned malformed intent signing data.',
    )
  }
  return {
    origin: value.origin.map(supportedOriginSignData),
    ...(value.destination === undefined
      ? {}
      : {
          destination: supportedTypedData(value.destination, { tagged: false }),
        }),
    ...(value.targetExecution === undefined
      ? {}
      : {
          targetExecution: supportedTypedData(value.targetExecution, {
            tagged: false,
          }),
        }),
  }
}

function mapQuoteFromWire(value: WireQuote): OrchestratorQuote {
  return {
    intentId: value.intentId,
    expiresAt: value.expiresAt,
    estimatedFillTime: value.estimatedFillTime,
    settlementLayer: value.settlementLayer,
    signData: mapSupportedSignData(value.signData),
    cost: mapCostFromWire(value.cost),
    ...(value.tokenRequirements === undefined
      ? {}
      : {
          tokenRequirements: mapTokenRequirementsFromWire(
            value.tokenRequirements,
          ),
        }),
    ...mapBridgeFillFromWire(value.bridgeFill),
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
    tokenAddress: value.tokenAddress,
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

// A bridge fill is a delivery-tracking handle, not part of what the user signs,
// so a type this SDK version predates must not fail the whole quote. Returning
// a key-or-nothing spread leaves an unknown layer as an untracked route, the
// same shape a layer that publishes no handle already produces.
function mapBridgeFillFromWire(value: WireQuote['bridgeFill']): {
  bridgeFill?: BridgeFill
} {
  if (value === undefined) return {}
  switch (value.type) {
    case 'OFT':
      return {
        bridgeFill: {
          type: 'OFT',
          destinationChainId: value.destinationChainId,
        },
      }
    case 'ECO':
      return {
        bridgeFill: {
          type: 'ECO',
          destinationChainId: value.destinationChainId,
          intentHash: value.intentHash as Hex,
          ...(value.providerDestinationChainId !== undefined
            ? {
                providerDestinationChainId: value.providerDestinationChainId,
              }
            : {}),
        },
      }
    case 'RELAY':
      return {
        bridgeFill: {
          type: 'RELAY',
          destinationChainId: value.destinationChainId,
          requestId: value.requestId,
        },
      }
    case 'NEAR':
      return {
        bridgeFill: {
          type: 'NEAR',
          destinationChainId: value.destinationChainId,
          depositAddress: value.depositAddress as Address,
        },
      }
    case 'RHINO':
      return {
        bridgeFill: {
          type: 'RHINO',
          destinationChainId: value.destinationChainId,
          commitmentId: value.commitmentId,
        },
      }
    case 'CCTP':
      return {
        bridgeFill: {
          type: 'CCTP',
          destinationChainId: value.destinationChainId,
          sourceDomainId: value.sourceDomainId,
          destinationDomainId: value.destinationDomainId,
        },
      }
    case 'LZ':
      return {
        bridgeFill: {
          type: 'LZ',
          destinationChainId: value.destinationChainId,
          quoteId: value.quoteId,
          dstChainKey: value.dstChainKey,
          routeTypes: [...value.routeTypes],
        },
      }
    default:
      return {}
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

function mapQuoters(
  input: OrchestratorIntentRequest['options']['quoters'],
): NonNullable<WireQuoteRequest['options']>['quoters'] {
  // Same widening as `mapSettlementLayers`: the port keeps `string[]` so it does
  // not depend on the venue enum, and the wire narrows it.
  return input as NonNullable<WireQuoteRequest['options']>['quoters']
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
