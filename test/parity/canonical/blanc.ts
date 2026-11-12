import { portfolioQuery, tokenAmountRecord } from './alps'
import {
  amount,
  asRecord,
  chainIdNumber,
  compact,
  filterList,
  lowerHex,
  mapChainKeys,
  signatureModeNumber,
} from './common'
import { sortCostTokens } from './cost'
import type {
  CanonicalCost,
  CanonicalFee,
  CanonicalQuoteRequest,
  CanonicalSubmitRequest,
  VersionAdapter,
} from './types'

// Version `2026-04.blanc`: the target of the v1 migration.

function account(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined
  const input = asRecord(value)
  return lowerHex(
    compact({
      ...input,
      delegations: mapChainKeys(input.delegations),
      mockSignatures: mapChainKeys(input.mockSignatures),
    }),
  )
}

function executions(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((execution) => {
    const input = asRecord(execution)
    return lowerHex(compact({ ...input, value: amount(input.value) }))
  })
}

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

function quoteRequest(body: unknown): CanonicalQuoteRequest {
  const {
    account: rawAccount,
    recipient,
    destinationChainId,
    destinationExecutions,
    destinationGasLimit,
    tokenRequests,
    accountAccessList,
    options: rawOptions,
    preClaimExecutions,
    ...rest
  } = asRecord(body)
  return compact({
    ...lowerHex(rest),
    destinationChainId: chainIdNumber(destinationChainId),
    tokenRequests: (Array.isArray(tokenRequests) ? tokenRequests : []).map(
      (request) => {
        const item = asRecord(request)
        return compact({
          token: String(item.tokenAddress).toLowerCase(),
          amount: amount(item.amount),
        })
      },
    ),
    account: account(rawAccount) ?? {},
    recipient: account(recipient),
    destinationExecutions: executions(destinationExecutions) ?? [],
    destinationGasLimit: amount(destinationGasLimit),
    preClaimExecutions: mapChainKeys(preClaimExecutions, executions) as
      | Record<string, unknown[]>
      | undefined,
    accountAccessList: accessList(accountAccessList),
    options: options(rawOptions),
  })
}

function authorization(value: unknown) {
  const input = asRecord(value)
  return lowerHex(compact({ ...input, chainId: chainIdNumber(input.chainId) }))
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
  apiVersion: 'blanc',
  quoteRequest,
  submitRequest,
  cost,
  wireError,
  readParams(op, { path, query, body }) {
    switch (op) {
      case 'status':
        return { intentId: decodeURIComponent(path.split('/').pop() ?? '') }
      case 'portfolio': {
        const { filterEmpty, ...rest } = query
        return compact({
          account: decodeURIComponent(path.split('/')[2] ?? '').toLowerCase(),
          ...portfolioQuery(rest),
          filterEmpty,
        })
      }
      case 'splits': {
        const input = asRecord(body)
        return compact({
          chainId: chainIdNumber(input.chainId),
          tokens: tokenAmountRecord(input.tokens),
          settlementLayers: filterList(input.settlementLayers),
        })
      }
      case 'appFeeBalances':
        return {}
    }
  },
  submitStub(body) {
    return { status: 201, body: { intentId: String(asRecord(body).intentId) } }
  },
}

export { blanc }
