import type { Address, SignedAuthorization } from 'viem'
import {
  chainIdFromReference,
  formatCaip2,
  parseCaip2,
} from '../../chains/caip2'
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
  const input = value as {
    readonly traceId?: string
    readonly routes?: readonly Record<string, unknown>[]
  }
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
  const input = value as {
    readonly traceId?: string
    readonly status?: string
    readonly accountAddress?: Address
    readonly operations?: readonly {
      readonly chain?: string | number
      readonly items?: readonly unknown[]
    }[]
  }
  return {
    traceId: input.traceId ?? '',
    intentId,
    status: input.status ?? '',
    account:
      input.accountAddress ??
      ('0x0000000000000000000000000000000000000000' as Address),
    operations: (input.operations ?? []).map((operation) => ({
      chain: parseChainValue(operation.chain),
      ...((operation.items?.[0] as Record<string, unknown> | undefined) ?? {}),
    })),
  }
}

export function mapPortfolioFromWire(value: unknown): OrchestratorPortfolio {
  const input = value as {
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
        address: chain.address,
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
  const input = value as {
    readonly traceId?: string
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

function mapQuoteFromWire(value: Record<string, unknown>): OrchestratorQuote {
  return {
    intentId: String(value.intentId ?? ''),
    expiresAt: Number(value.expiresAt ?? 0),
    estimatedFillTime: value.estimatedFillTime as { readonly seconds: number },
    settlementLayer: String(value.settlementLayer ?? ''),
    signData: value.signData as OrchestratorQuote['signData'],
    cost: value.cost,
    ...(value.tokenRequirements === undefined
      ? {}
      : { tokenRequirements: value.tokenRequirements }),
    ...(value.bridgeFill === undefined
      ? {}
      : { bridgeFill: stripBridgeFillTimeout(value.bridgeFill) }),
  }
}

function stripBridgeFillTimeout(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const { fillStatusTimeout: _ignored, ...bridgeFill } = value as Record<
    string,
    unknown
  >
  return bridgeFill
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
