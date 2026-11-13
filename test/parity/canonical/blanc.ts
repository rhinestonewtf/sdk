import {
  alpsWireCode,
  amount,
  asRecord,
  authorization,
  blancCategoryFee,
  chainIdNumber,
  compact,
  type FeeCategory,
  filterList,
  lowerHex,
  mapChainKeys,
  quoteRequest,
  requestSponsorship,
  signatureModeNumber,
  sortCostTokens,
  tokenAmountRecord,
} from './common'
import type {
  CanonicalCost,
  CanonicalSubmitRequest,
  VersionAdapter,
} from './types'

// Version `2026-04.blanc`: the target of the v1 migration.

function accessList(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  const input = asRecord(value)
  return lowerHex(
    compact({
      ...input,
      chainIds: Array.isArray(input.chainIds)
        ? input.chainIds.map(chainIdNumber)
        : undefined,
      chainTokens: mapChainKeys(input.chainTokens),
      chainTokenAmounts: mapChainKeys(
        input.chainTokenAmounts,
        tokenAmountRecord,
      ),
    }),
  )
}

function options(value: unknown): Record<string, unknown> {
  const input = asRecord(value)
  return lowerHex(
    compact({
      ...input,
      settlementLayers: filterList(input.settlementLayers),
      quoters: filterList(input.quoters),
      signatureMode: signatureModeNumber(input.signatureMode),
      auxiliaryFunds: mapChainKeys(input.auxiliaryFunds, tokenAmountRecord),
    }),
  )
}

function submitRequest(body: unknown): CanonicalSubmitRequest {
  const {
    intentId: _intentId,
    signatures,
    authorizations,
    ...rest
  } = asRecord(body)
  const sigs = asRecord(signatures)
  const auth = asRecord(authorizations)
  return compact({
    ...lowerHex(rest),
    quoteRef: '<quote>' as const,
    signatures: lowerHex(
      compact({
        origin: Array.isArray(sigs.origin) ? sigs.origin : [],
        destination: sigs.destination,
        targetExecution: sigs.targetExecution,
      }),
    ),
    authorizations: authorizations
      ? compact({
          sponsor: Array.isArray(auth.sponsor)
            ? auth.sponsor.map(authorization)
            : undefined,
          recipient: Array.isArray(auth.recipient)
            ? auth.recipient.map(authorization)
            : undefined,
        })
      : undefined,
    permits: sigs.permits
      ? (lowerHex(mapChainKeys(sigs.permits)) as Record<
          string,
          Record<string, string>
        >)
      : undefined,
  })
}

function costToken(value: unknown) {
  const input = asRecord(value)
  return {
    chainId: chainIdNumber(input.chainId),
    token: String(input.tokenAddress).toLowerCase(),
    amount: amount(input.amount) as string,
  }
}

// v1 always takes the recommended route, `routes[0]`.
function cost(
  responseBody: unknown,
  requestBody: unknown,
): CanonicalCost | undefined {
  const routes = asRecord(responseBody).routes
  const route = Array.isArray(routes) ? asRecord(routes[0]) : undefined
  if (!route?.cost) return undefined
  const routeCost = asRecord(route.cost)
  const fees = asRecord(routeCost.fees)
  const breakdown = asRecord(fees.breakdown)
  const sponsored = requestSponsorship(requestBody)
  const fee = (category: FeeCategory) =>
    blancCategoryFee(asRecord(breakdown[category]), sponsored[category])
  return {
    inputs: sortCostTokens((routeCost.input ?? []).map(costToken)),
    outputs: sortCostTokens((routeCost.output ?? []).map(costToken)),
    fees: {
      totalUsd: asRecord(fees.total).usd ?? 0,
      gas: fee('gas'),
      bridge: fee('bridge'),
      swap: fee('swap'),
      app: fee('app'),
      protocol: fee('protocol'),
    },
    versionOnly: {
      blanc: compact({
        sponsorSurcharge: breakdown.sponsorSurcharge,
        executionPayment: routeCost.executionPayment,
      }),
    },
  }
}

// Blanc's envelope code is coarse (`UNPROCESSABLE_CONTENT` for every planning
// refusal, `VALIDATION_ERROR` for every 400); compare the domain code alps
// exposes, which blanc keeps in `details`.
function wireError(status: number, body: unknown) {
  const input = asRecord(body)
  let code: unknown
  if (Array.isArray(input.errors)) {
    // Blanc still answers some failures (malformed JSON) in the alps shape.
    return compact({ status, code: alpsWireCode(body) })
  }
  if (Array.isArray(input.details)) {
    code = asRecord(asRecord(input.details[0]).context).code
  } else if (input.code === 'INSUFFICIENT_LIQUIDITY') {
    code = input.code
  } else if (input.details === undefined) {
    // The gateway's auth body is the same on both versions and is the only
    // one that carries a body trace id; an orchestrator envelope without
    // details has no domain code.
    code = typeof input.traceId === 'string' ? input.code : undefined
  } else {
    code = asRecord(input.details).code
  }
  return compact({ status, code: typeof code === 'string' ? code : undefined })
}

const blanc: VersionAdapter = {
  quoteRequest: (body) =>
    quoteRequest(body, {
      gasLimitKey: 'destinationGasLimit',
      accessList,
      options,
    }),
  submitRequest,
  cost,
  wireError,
  submitStub(body) {
    return { status: 201, body: { intentId: String(asRecord(body).intentId) } }
  },
  submittedIntentId(responseBody) {
    const id = asRecord(responseBody).intentId
    return id === undefined || id === null ? undefined : String(id)
  },
}

export { blanc }
