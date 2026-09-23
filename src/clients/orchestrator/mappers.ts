import type { Address } from 'viem'
import {
  chainIdFromReference,
  formatCaip2,
  parseCaip2,
} from '../../chains/caip2'
import { ValidationError } from './errors'
import type {
  BridgeFill,
  Cost,
  CostTokenEntry,
  IntentDetails,
  IntentOperationGroup,
  IntentRequirement,
  SigningProof,
  SigningRequest,
} from './public'
import { serializeBigInts } from './serialization'
import type {
  OrchestratorDeploymentCost,
  OrchestratorIntentRequest,
  OrchestratorIntentStatus,
  OrchestratorIntentSubmission,
  OrchestratorPortfolio,
  OrchestratorQuote,
  OrchestratorQuoteResponse,
  OrchestratorSignedIntent,
  OrchestratorSplitRequest,
  OrchestratorSplitResult,
} from './types'
import type {
  WireIntentRequest,
  WireIntentStatusResponse,
  WireIntentSubmitResponse,
  WirePortfolioResponse,
  WireQuote,
  WireQuoteRequest,
  WireQuoteResponse,
  WireSigningRequest,
  WireSplitRequest,
  WireSplitResponse,
} from './wire'

export function mapIntentRequestToWire(
  input: OrchestratorIntentRequest,
): WireQuoteRequest {
  return serializeBigInts({
    account: input.account,
    destination: input.destination,
    ...(input.source ? { source: input.source } : {}),
    ...(input.options
      ? {
          options: {
            ...input.options,
            settlementLayers: mapSettlementLayers(
              input.options.settlementLayers,
            ),
            quoters: mapQuoters(input.options.quoters),
          },
        }
      : {}),
  })
}

export function mapSignedIntentToWire(
  input: OrchestratorSignedIntent,
): WireIntentRequest {
  return serializeBigInts({
    intentId: input.intentId,
    proofs: input.proofs,
    ...(input.dryRun ? { options: { dryRun: true } } : {}),
  })
}

export function mapIntentSubmissionFromWire(
  intentId: string,
  value: unknown,
): OrchestratorIntentSubmission {
  const input = value as WireIntentSubmitResponse
  return { traceId: input.traceId ?? '', intentId: input.intentId ?? intentId }
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
        chain: parseNumericChainId(chain.chainId),
        address: chain.address as Address,
        decimals: chain.decimals,
        amount: BigInt(chain.amount),
      })),
    })),
  }
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export function mapQuoteResponseFromWire(
  value: unknown,
): OrchestratorQuoteResponse {
  const input = value as WireQuoteResponse
  // An outcome this SDK version does not know is refused rather than read as
  // "no routes": a reserved future status carries no route array, and treating
  // it as an empty success would report "no route available" for a quote the
  // orchestrator did answer.
  if (input.status !== 'quoted') {
    throw new ValidationError({
      message: `The orchestrator returned an unsupported quote outcome: ${String(
        (input as { status?: unknown }).status,
      )}.`,
    })
  }
  return {
    traceId: input.traceId ?? '',
    routes: (input.routes ?? []).map(mapQuoteFromWire),
  }
}

function mapQuoteFromWire(value: WireQuote): OrchestratorQuote {
  const route = {
    intentId: value.intentId,
    expiresAt: value.expiresAt,
    estimatedFillTime: value.estimatedFillTime,
    settlementLayer: value.settlementLayer,
    plan: value.plan as OrchestratorQuote['plan'],
    cost: mapCostFromWire(value.cost),
    requirements: value.requirements.map(mapRequirementFromWire),
    signingRequests: value.signingRequests.map(mapSigningRequestFromWire),
  }
  switch (value.purpose) {
    case 'execution':
      return {
        ...route,
        purpose: 'execution',
        ...mapBridgeFillFromWire(value.bridgeFill),
      }
    case 'deployment':
      return {
        ...route,
        purpose: 'deployment',
        deploymentCosts: value.deploymentCosts.map(mapDeploymentCostFromWire),
      }
    default:
      return invalid(
        `The orchestrator returned a route with an unsupported purpose: ${String(
          (value as { purpose?: unknown }).purpose,
        )}.`,
      )
  }
}

function mapDeploymentCostFromWire(
  value: Extract<
    WireQuote,
    { purpose: 'deployment' }
  >['deploymentCosts'][number],
): OrchestratorDeploymentCost {
  return {
    vm: value.vm,
    chainId: value.chainId as OrchestratorDeploymentCost['chainId'],
    rent: {
      amount: BigInt(value.rent.amount),
      usd: value.rent.usd,
      sponsored: value.rent.sponsored,
    },
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
    chainId: value.chainId,
    tokenAddress: value.tokenAddress,
    symbol: value.symbol,
    decimals: value.decimals,
    price: value.price,
    amount: BigInt(value.amount),
  }
}

function mapRequirementFromWire(
  value: WireQuote['requirements'][number],
): IntentRequirement {
  return {
    ...value,
    amount: BigInt(value.amount),
  } as IntentRequirement
}

// ---------------------------------------------------------------------------
// Signing requests
//
// This is the trust boundary: an unrecognised authority, scope or payload kind
// must never be narrowed onto a familiar one, because the difference is what
// the user is authorising. Everything else is disclosure and passes through.
// ---------------------------------------------------------------------------

const SIGNING_PURPOSES = new Set([
  'originAuthorization',
  'destinationAuthorization',
  'targetExecutionAuthorization',
  'delegationAuthorization',
])

function invalid(message: string): never {
  throw new ValidationError({ message })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mapSigningRequestFromWire(
  value: WireSigningRequest | unknown,
): SigningRequest {
  if (!isObject(value)) {
    invalid('The orchestrator returned a malformed signing request.')
  }
  const account = value.account
  if (
    !isObject(account) ||
    (account.vm !== 'evm' && account.vm !== 'svm') ||
    (account.vm === 'evm' && typeof account.address !== 'string') ||
    (account.vm === 'svm' &&
      (typeof account.wallet !== 'string' ||
        typeof account.swigAccount !== 'string'))
  ) {
    invalid(
      `The orchestrator returned a signing request for an unsupported account: ${String(
        (account as { vm?: unknown } | undefined)?.vm,
      )}.`,
    )
  }
  const authority = value.authority
  if (
    !isObject(authority) ||
    (authority.kind !== 'secp256k1' &&
      authority.kind !== 'account' &&
      authority.kind !== 'swigRole')
  ) {
    invalid(
      `The orchestrator returned a signing request with an unsupported authority: ${String(
        (authority as { kind?: unknown } | undefined)?.kind,
      )}.`,
    )
  }
  if (authority.kind === 'swigRole') {
    const role = authority.authority
    if (
      !isObject(role) ||
      !(
        (role.kind === 'secp256k1' && typeof role.address === 'string') ||
        (role.kind === 'secp256r1' && typeof role.publicKey === 'string')
      )
    ) {
      invalid(
        `The orchestrator returned a signing request with an unsupported Swig role authority: ${String(
          (role as { kind?: unknown } | undefined)?.kind,
        )}.`,
      )
    }
  }
  const scope = value.scope
  if (!isObject(scope) || (scope.vm !== 'evm' && scope.vm !== 'svm')) {
    invalid(
      `The orchestrator returned a signing request with an unsupported scope: ${String(
        (scope as { vm?: unknown } | undefined)?.vm,
      )}.`,
    )
  }
  if (
    typeof value.purpose !== 'string' ||
    !SIGNING_PURPOSES.has(value.purpose)
  ) {
    invalid(
      `The orchestrator returned a signing request with an unsupported purpose: ${String(
        value.purpose,
      )}.`,
    )
  }
  if (!Array.isArray(value.chainIds) || !Array.isArray(value.validity)) {
    invalid(
      'The orchestrator returned a signing request without chain or validity context.',
    )
  }
  return {
    account,
    authority,
    scope,
    chainIds: value.chainIds,
    purpose: value.purpose,
    validity: value.validity,
    payload: mapSigningPayloadFromWire(value.payload),
  } as SigningRequest
}

function mapSigningPayloadFromWire(value: unknown): SigningRequest['payload'] {
  if (!isObject(value)) {
    invalid('The orchestrator returned a signing request with no payload.')
  }
  switch (value.kind) {
    case 'eip712': {
      const typedData = value.typedData
      if (
        !isObject(typedData) ||
        !isObject(typedData.domain) ||
        !isObject(typedData.types) ||
        typeof typedData.primaryType !== 'string' ||
        !isObject(typedData.message) ||
        (value.signatureFormat !== 'secp256k1' &&
          value.signatureFormat !== 'account')
      ) {
        invalid('The orchestrator returned an invalid EIP-712 signing payload.')
      }
      return value as SigningRequest['payload']
    }
    case 'personalSign': {
      const message = value.message
      if (
        !isObject(message) ||
        message.encoding !== 'utf8' ||
        typeof message.value !== 'string'
      ) {
        invalid(
          'The orchestrator returned an invalid personal-sign signing payload.',
        )
      }
      return value as SigningRequest['payload']
    }
    case 'eip7702': {
      const authorization = value.authorization
      if (
        !isObject(authorization) ||
        typeof authorization.chainId !== 'number' ||
        typeof authorization.address !== 'string'
      ) {
        invalid(
          'The orchestrator returned an invalid EIP-7702 signing payload.',
        )
      }
      return value as SigningRequest['payload']
    }
    case 'webauthn':
      if (typeof value.challenge !== 'string') {
        invalid(
          'The orchestrator returned an invalid WebAuthn signing payload.',
        )
      }
      return value as SigningRequest['payload']
    default:
      return invalid(
        `The orchestrator returned an unsupported signing payload kind: ${String(
          value.kind,
        )}.`,
      )
  }
}

/** Narrows a caller-supplied proof before it is sent. */
export function assertSupportedProof(value: SigningProof): SigningProof {
  switch (value.kind) {
    case 'eip712':
    case 'personalSign':
    case 'eip7702':
    case 'webauthn':
      return value
    default:
      return invalid(
        `Unsupported intent proof kind: ${String(
          (value as { kind?: unknown }).kind,
        )}.`,
      )
  }
}

// A bridge fill is a delivery-tracking handle, not part of what the user signs,
// so a type this SDK version predates must not fail the whole quote. Returning
// a key-or-nothing spread leaves an unknown layer as an untracked route, the
// same shape a layer that publishes no handle already produces.
function mapBridgeFillFromWire(
  value: Extract<WireQuote, { purpose: 'execution' }>['bridgeFill'],
): {
  bridgeFill?: BridgeFill
} {
  if (value === undefined) return {}
  switch (value.type) {
    case 'OFT':
    case 'ECO':
    case 'RELAY':
    case 'NEAR':
    case 'RHINO':
    case 'CCTP':
    case 'LZ':
      return { bridgeFill: value as BridgeFill }
    default:
      return {}
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function mapIntentStatusFromWire(
  intentId: string,
  value: unknown,
): OrchestratorIntentStatus {
  const input = value as WireIntentStatusResponse
  return {
    traceId: input.traceId ?? '',
    intentId: input.intentId ?? intentId,
    purpose: input.purpose,
    status: input.status,
    // Absent stays absent: the record either identifies the accounts or it
    // does not, and a fabricated zero address is not the same fact.
    ...(input.accounts
      ? { accounts: input.accounts as OrchestratorIntentStatus['accounts'] }
      : {}),
    operations: (input.operations ?? []) as readonly IntentOperationGroup[],
    ...(input.refunds
      ? { refunds: input.refunds as OrchestratorIntentStatus['refunds'] }
      : {}),
    ...(input.details
      ? { details: mapIntentDetailsFromWire(input.details) }
      : {}),
  }
}

function mapIntentDetailsFromWire(
  value: NonNullable<NonNullable<WireIntentStatusResponse['details']>>,
): IntentDetails {
  type Leg = NonNullable<typeof value>['destination']
  const leg = (entry: Leg) => ({
    ...entry,
    tokens: (entry?.tokens ?? []).map((token) => ({
      ...token,
      amount: BigInt(token.amount),
    })),
  })
  return {
    ...value,
    source: value.source.map(leg),
    destination: leg(value.destination),
    cost: {
      sponsored: value.cost.sponsored,
      ...(value.cost.sponsoredValue === undefined
        ? {}
        : { sponsoredValue: BigInt(value.cost.sponsoredValue) }),
      ...(value.cost.protocolFee === undefined
        ? {}
        : { protocolFee: BigInt(value.cost.protocolFee) }),
      ...(value.cost.sponsorSurcharge === undefined
        ? {}
        : { sponsorSurcharge: BigInt(value.cost.sponsorSurcharge) }),
    },
  } as IntentDetails
}

/**
 * Numeric chain id for the endpoints whose SDK projection is still numeric
 * (portfolio, splits). Wire-facing Caucasus metadata keeps its CAIP-2 string.
 */
function parseNumericChainId(value: string | number | undefined): number {
  if (typeof value === 'number') return value
  if (value === undefined) throw new Error('Orchestrator chain id is missing')
  if (/^\d+$/u.test(value)) return Number(value)
  return chainIdFromReference(parseCaip2(value))
}

type WireQuoteOptions = NonNullable<WireQuoteRequest['options']>

// The port keeps settlement layers and quoters as plain strings so it does not
// depend on the generated venue enums; the wire narrows them. Widening these
// two fields, rather than casting the whole body, is what keeps a drifting
// account/destination/source shape a typecheck error here.
type VenueFilter =
  | { readonly include: readonly string[] }
  | { readonly exclude: readonly string[] }

function mapSettlementLayers(
  input: VenueFilter | undefined,
): WireQuoteOptions['settlementLayers'] {
  return input as WireQuoteOptions['settlementLayers']
}

function mapQuoters(
  input: VenueFilter | undefined,
): WireQuoteOptions['quoters'] {
  return input as WireQuoteOptions['quoters']
}
