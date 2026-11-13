// Blanc quote and submit wire for v1: encodes v1's quote request in blanc's
// shape and decodes the recommended route into the v1 Quote.
import type {
  Address,
  Hex,
  SignedAuthorizationList,
  TypedDataDefinition,
  TypedDataParameter,
} from 'viem'
import type { Orchestrator } from './client'
import { OrchestratorError } from './error'
import type {
  Account,
  AccountAccessList,
  IntentInput,
  OriginSignature,
  Quote,
  QuoteCost,
  SettlementLayer,
  TokenRequirements,
} from './types'
import { convertBigIntFields } from './utils'
import { caipChainIdsToNumbers } from './wire-error'
import { toCaip2 } from './wire-read'

type TypedDataTypes = Record<string, readonly TypedDataParameter[]>

interface BlancCostToken {
  chainId: string
  tokenAddress: Address
  symbol: string | null
  decimals: number | null
  price: { usd: number } | null
  amount: string
}

interface BlancRoute {
  intentId: string
  expiresAt: number
  estimatedFillTime: { seconds: number }
  settlementLayer: SettlementLayer
  signData: {
    origin: unknown[]
    destination?: unknown
    targetExecution?: unknown
  }
  cost: {
    input: BlancCostToken[]
    output: BlancCostToken[]
    fees: QuoteCost['fees']
  }
  tokenRequirements?: Record<
    string,
    Record<
      Address,
      | { type: 'approval'; amount: string; spender: Address; permit?: unknown }
      | { type: 'wrap'; amount: string }
    >
  >
}

function chainKeys<T>(
  record: Record<string | number, T> | undefined,
): Record<string, T> | undefined {
  if (!record) return record
  return Object.fromEntries(
    Object.entries(record).map(([chainId, value]) => [toCaip2(chainId), value]),
  )
}

function omitUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
}

// Blanc refuses the singular `mockSignature`. Mirrors the orchestrator's alps
// lowering, which folds it into the cross-chain fallback `mockSignatures['0']`
// unless that is set, so both versions plan the same request.
function blancAccount(account: Account | undefined) {
  if (!account) return account
  const { mockSignature, mockSignatures, ...rest } = account
  if (mockSignature === undefined && mockSignatures === undefined) return rest
  return {
    ...rest,
    mockSignatures: {
      ...(mockSignature !== undefined ? { '0': mockSignature } : {}),
      ...mockSignatures,
    },
  }
}

// Mirrors the orchestrator's alps lowering of the flat access list, so both
// versions plan the same request: every token per chain, deduplicated in
// first-seen order, plus the amounts of the entries that carry one.
function blancAccessList(list: AccountAccessList | undefined) {
  if (list === undefined) return undefined
  if (Array.isArray(list)) {
    const chainTokens: Record<string, Address[]> = {}
    const chainTokenAmounts: Record<string, Record<Address, bigint>> = {}
    for (const { chainId, tokenAddress, amount } of list) {
      const key = toCaip2(chainId)
      chainTokens[key] ??= []
      if (!chainTokens[key].includes(tokenAddress)) {
        chainTokens[key].push(tokenAddress)
      }
      if (amount !== undefined && amount !== null) {
        chainTokenAmounts[key] ??= {}
        chainTokenAmounts[key][tokenAddress] = amount
      }
    }
    return Object.keys(chainTokenAmounts).length > 0
      ? { chainTokens, chainTokenAmounts }
      : { chainTokens }
  }
  const { chainIds, chainTokens, ...rest } = list as {
    chainIds?: number[]
    chainTokens?: Record<number, unknown>
  }
  return omitUndefined({
    ...rest,
    chainIds: chainIds?.map(toCaip2),
    chainTokens: chainKeys(chainTokens),
  })
}

function blancOptions(options: IntentInput['options']) {
  // Neither API version defines `topupCompact` or `feeToken`; the orchestrator
  // discards both.
  const {
    topupCompact: _topupCompact,
    feeToken: _feeToken,
    sponsorSettings,
    auxiliaryFunds,
    ...rest
  } = options
  return omitUndefined({
    ...rest,
    sponsorSettings: sponsorSettings
      ? omitUndefined({
          gas: sponsorSettings.gasSponsored,
          bridgeFees: sponsorSettings.bridgeFeesSponsored,
          swapFees: sponsorSettings.swapFeesSponsored,
          protocolFees: sponsorSettings.protocolFeesSponsored,
        })
      : undefined,
    auxiliaryFunds: chainKeys(auxiliaryFunds),
  })
}

function blancQuoteRequest(input: IntentInput): Record<string, unknown> {
  const {
    destinationChainId,
    destinationGasUnits,
    account,
    recipient,
    accountAccessList,
    options,
    preClaimExecutions,
    ...rest
  } = input
  return convertBigIntFields(
    omitUndefined({
      ...rest,
      destinationChainId: toCaip2(destinationChainId),
      destinationGasLimit: destinationGasUnits,
      account: blancAccount(account),
      recipient: blancAccount(recipient),
      accountAccessList: blancAccessList(accountAccessList),
      options: options ? blancOptions(options) : undefined,
      preClaimExecutions: chainKeys(preClaimExecutions),
    }),
  )
}

function normalizeMessage(
  types: TypedDataTypes,
  primaryType: string,
  message: Record<string, unknown>,
): Record<string, unknown> {
  const fields = types[primaryType]
  if (!fields) return message
  return Object.fromEntries(
    Object.entries(message).map(([name, value]) => {
      const type = fields.find((field) => field.name === name)?.type
      return [name, type ? normalizeValue(types, type, value) : value]
    }),
  )
}

function normalizeValue(
  types: TypedDataTypes,
  type: string,
  value: unknown,
): unknown {
  if (value === null || value === undefined) return value
  const array = type.match(/^(.+)\[\d*\]$/u)
  if (array) {
    return Array.isArray(value)
      ? value.map((item) => normalizeValue(types, array[1], item))
      : value
  }
  if (/^u?int\d*$/u.test(type)) {
    return typeof value === 'string' || typeof value === 'number'
      ? BigInt(value)
      : value
  }
  return types[type]
    ? normalizeMessage(types, type, value as Record<string, unknown>)
    : value
}

// Blanc serves uints as decimal strings; v1 has always handed bigints to
// signers and integrators. The domain is kept as served.
function normalizeTypedData(typedData: unknown): TypedDataDefinition {
  const { kind: _kind, ...rest } = typedData as Record<string, unknown>
  const { types, primaryType, message } = rest as {
    types: TypedDataTypes
    primaryType: string
    message: Record<string, unknown>
  }
  return {
    ...rest,
    message: normalizeMessage(types, primaryType, message),
  } as TypedDataDefinition
}

// The one place v1 reads a payload's chain. RHI-9153 replaces the refusal.
function originChainId(typedData: TypedDataDefinition): number {
  const chainId = typedData.domain?.chainId
  if (chainId === undefined || chainId === null) {
    throw new Error(
      'This quote asks for one signature over several chains (MultiChainOps), which this SDK version cannot sign yet',
    )
  }
  return Number(chainId)
}

function signPayload(payload: unknown): TypedDataDefinition {
  if ((payload as { kind?: unknown }).kind === 'personalSign') {
    throw new OrchestratorError({
      message: 'non-EVM origin payloads are not supported by this SDK version',
    })
  }
  return normalizeTypedData(payload)
}

function costToken(token: BlancCostToken) {
  return {
    chainId: caipChainIdsToNumbers(token.chainId) as number,
    tokenAddress: token.tokenAddress,
    symbol: token.symbol,
    decimals: token.decimals,
    price: token.price,
    amount: BigInt(token.amount),
  }
}

function tokenRequirementsFromBlanc(
  requirements: BlancRoute['tokenRequirements'],
): TokenRequirements | undefined {
  if (!requirements) return undefined
  return Object.fromEntries(
    Object.entries(requirements).map(([chainId, tokens]) => [
      caipChainIdsToNumbers(chainId),
      Object.fromEntries(
        Object.entries(tokens).map(([token, requirement]) => [
          token,
          requirement.type === 'approval'
            ? omitUndefined({
                ...requirement,
                amount: BigInt(requirement.amount),
                permit: requirement.permit
                  ? normalizeTypedData(requirement.permit)
                  : undefined,
              })
            : { ...requirement, amount: BigInt(requirement.amount) },
        ]),
      ),
    ]),
  ) as TokenRequirements
}

function quoteFromBlanc(route: BlancRoute): Quote {
  const origin = route.signData.origin.map(signPayload)
  const { destination, targetExecution } = route.signData
  return omitUndefined({
    intentId: route.intentId,
    expiresAt: route.expiresAt,
    estimatedFillTime: route.estimatedFillTime,
    settlementLayer: route.settlementLayer,
    signData: omitUndefined({
      origin,
      // Alps semantics: without a separate destination payload, the last
      // origin payload is the destination.
      destination: destination ? signPayload(destination) : origin.at(-1)!,
      targetExecution: targetExecution
        ? signPayload(targetExecution)
        : undefined,
    }),
    cost: {
      input: route.cost.input.map(costToken),
      output: route.cost.output.map(costToken),
      fees: route.cost.fees,
    },
    tokenRequirements: tokenRequirementsFromBlanc(route.tokenRequirements),
  })
}

function quotesFromBlanc(body: { routes?: BlancRoute[] }): Quote[] {
  return (body.routes ?? []).map(quoteFromBlanc)
}

function authorizationChainId(chainId: number): 0 | string {
  if (chainId === 0) return 0
  if (!Number.isSafeInteger(chainId) || chainId < 0) {
    throw new Error(`Invalid EIP-7702 authorization chain ID: ${chainId}`)
  }
  return toCaip2(chainId)
}

function blancSubmitRequest(input: {
  quote: Pick<Quote, 'intentId'>
  originSignatures: OriginSignature[]
  destinationSignature: Hex
  targetExecutionSignature?: Hex
  permitSignatures?: Record<number, Record<Address, Hex>>
  authorizations: SignedAuthorizationList
  dryRun: boolean
}): Parameters<Orchestrator['createIntent']>[0] {
  const sponsor = input.authorizations.map((authorization) => ({
    chainId: authorizationChainId(authorization.chainId),
    address: authorization.address,
    nonce: authorization.nonce,
    yParity: authorization.yParity ?? 0,
    r: authorization.r,
    s: authorization.s,
  }))
  return omitUndefined({
    intentId: input.quote.intentId,
    signatures: omitUndefined({
      origin: input.originSignatures,
      destination: input.destinationSignature,
      targetExecution: input.targetExecutionSignature,
      permits: input.permitSignatures,
    }),
    authorizations: sponsor.length > 0 ? { sponsor } : undefined,
    options: input.dryRun ? { dryRun: true as const } : undefined,
  })
}

export type { BlancRoute }
export {
  blancQuoteRequest,
  blancSubmitRequest,
  normalizeTypedData,
  originChainId,
  quoteFromBlanc,
  quotesFromBlanc,
}
