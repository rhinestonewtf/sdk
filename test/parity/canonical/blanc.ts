import {
  amount,
  asRecord,
  authorization,
  chainIdNumber,
  compact,
  filterList,
  lowerHex,
  mapChainKeys,
  quoteRequest,
  signatureModeNumber,
  sortCostTokens,
  tokenAmountRecord,
} from './common'
import type {
  CanonicalCost,
  CanonicalFee,
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
    permitSignatures,
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
    permits: permitSignatures
      ? (lowerHex(mapChainKeys(permitSignatures)) as Record<
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

function fee(value: unknown): CanonicalFee {
  const input = asRecord(value)
  return { usd: input.usd ?? 0, sponsored: input.sponsored === true }
}

// v1 always takes the recommended route, `routes[0]`.
function cost(responseBody: unknown): CanonicalCost | undefined {
  const routes = asRecord(responseBody).routes
  const route = Array.isArray(routes) ? asRecord(routes[0]) : undefined
  if (!route?.cost) return undefined
  const routeCost = asRecord(route.cost)
  const fees = asRecord(routeCost.fees)
  const breakdown = asRecord(fees.breakdown)
  return {
    inputs: sortCostTokens((routeCost.input ?? []).map(costToken)),
    outputs: sortCostTokens((routeCost.output ?? []).map(costToken)),
    fees: {
      totalUsd: asRecord(fees.total).usd ?? 0,
      gas: fee(breakdown.gas),
      bridge: fee(breakdown.bridge),
      swap: fee(breakdown.swap),
      app: fee(breakdown.app),
      protocol: fee(breakdown.protocol),
    },
    versionOnly: {
      blanc: compact({
        sponsorSurcharge: breakdown.sponsorSurcharge,
        executionPayment: routeCost.executionPayment,
      }),
    },
  }
}

function wireError(status: number, body: unknown) {
  const code = asRecord(body).code
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
