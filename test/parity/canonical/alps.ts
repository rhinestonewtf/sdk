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
import { sortCostTokens, sumAmounts } from './cost'
import type {
  CanonicalCost,
  CanonicalQuoteRequest,
  CanonicalSubmitRequest,
  VersionAdapter,
} from './types'

// Version `2026-01.alps`: what v1 1.22.0 speaks.

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

function tokenAmountRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [token, entry] of Object.entries(asRecord(value))) {
    out[token.toLowerCase()] = amount(entry) as string
  }
  return out
}

function accessList(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    // Legacy `[{ chainId, tokenAddress, amount? }]` → per-chain token amounts.
    const chainTokenAmounts: Record<string, Record<string, string | null>> = {}
    for (const entry of value) {
      const item = asRecord(entry)
      const chain = String(chainIdNumber(item.chainId))
      chainTokenAmounts[chain] ??= {}
      chainTokenAmounts[chain][String(item.tokenAddress).toLowerCase()] =
        amount(item.amount) ?? null
    }
    return { chainTokenAmounts }
  }
  const input = asRecord(value)
  return lowerHex(
    compact({
      ...input,
      chainIds: Array.isArray(input.chainIds)
        ? input.chainIds.map(chainIdNumber)
        : undefined,
      chainTokens: mapChainKeys(input.chainTokens),
    }),
  )
}

function sponsorSettings(value: unknown): unknown {
  if (!value) return undefined
  const input = asRecord(value)
  const {
    gasSponsored,
    bridgeFeesSponsored,
    swapFeesSponsored,
    protocolFeesSponsored,
    ...rest
  } = input
  return compact({
    ...rest,
    gas: gasSponsored,
    bridgeFees: bridgeFeesSponsored,
    swapFees: swapFeesSponsored,
    protocolFees: protocolFeesSponsored,
  })
}

function options(value: unknown): Record<string, unknown> {
  const input = asRecord(value)
  return lowerHex(
    compact({
      ...input,
      sponsorSettings: sponsorSettings(input.sponsorSettings),
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
    destinationGasUnits,
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
    destinationGasLimit: amount(destinationGasUnits),
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
  const op = asRecord(asRecord(body).signedIntentOp)
  const {
    originSignatures,
    destinationSignature,
    targetExecutionSignature,
    signedAuthorizations,
    permitSignatures,
    options: submitOptions,
  } = op
  return compact({
    quoteRef: '<quote>' as const,
    signatures: lowerHex(
      compact({
        origin: Array.isArray(originSignatures) ? originSignatures : [],
        destination: destinationSignature,
        targetExecution: targetExecutionSignature,
      }),
    ),
    authorizations: Array.isArray(signedAuthorizations)
      ? { sponsor: signedAuthorizations.map(authorization) }
      : undefined,
    permits: permitSignatures
      ? (lowerHex(mapChainKeys(permitSignatures)) as Record<
          string,
          Record<string, string>
        >)
      : undefined,
    options: submitOptions ? lowerHex(submitOptions) : undefined,
  })
}

// Alps reports sponsorship as relayer/protocol USD totals, not per category,
// so the per-category flags come from what the request asked to sponsor.
function cost(
  responseBody: unknown,
  requestBody: unknown,
): CanonicalCost | undefined {
  const intentCost = asRecord(responseBody).intentCost
  if (!intentCost) return undefined
  const request = asRecord(requestBody)
  const destinationChainId = chainIdNumber(request.destinationChainId)
  const sponsor = asRecord(asRecord(request.options).sponsorSettings)
  const inputs = Object.entries(asRecord(intentCost.tokensSpent)).flatMap(
    ([chainId, tokens]) =>
      Object.entries(asRecord(tokens)).map(([token, spent]) => ({
        chainId: chainIdNumber(chainId),
        token: token.toLowerCase(),
        amount: sumAmounts([asRecord(spent).locked, asRecord(spent).unlocked]),
      })),
  )
  const outputs = (
    Array.isArray(intentCost.tokensReceived) ? intentCost.tokensReceived : []
  ).map((received: unknown) => {
    const item = asRecord(received)
    return {
      chainId: destinationChainId,
      token: String(item.tokenAddress).toLowerCase(),
      amount: amount(item.destinationAmount) as string,
    }
  })
  const usd = asRecord(intentCost.feeBreakdownUSD)
  return {
    inputs: sortCostTokens(inputs),
    outputs: sortCostTokens(outputs),
    fees: {
      totalUsd: usd.totalFeeUSD ?? 0,
      gas: {
        usd: usd.gasFeeUSD ?? 0,
        sponsored: sponsor.gasSponsored === true,
      },
      // Blanc has no settlement category; the settlement layer's fee is
      // part of what it reports as the bridge fee.
      bridge: {
        usd: (usd.bridgeFeeUSD ?? 0) + (usd.settlementFeeUSD ?? 0),
        sponsored: sponsor.bridgeFeesSponsored === true,
      },
      swap: {
        usd: usd.swapFeeUSD ?? 0,
        sponsored: sponsor.swapFeesSponsored === true,
      },
      app: { usd: usd.appFeeUSD ?? 0, sponsored: false },
      protocol: {
        usd: usd.protocolFeeUSD ?? 0,
        sponsored: sponsor.protocolFeesSponsored === true,
      },
    },
    versionOnly: {
      alps: compact({
        settlementFeeUsd: usd.settlementFeeUSD,
        sponsoredFee: intentCost.sponsoredFee ?? intentCost.sponsorFee,
      }),
    },
  }
}

function wireError(status: number, body: unknown) {
  const input = asRecord(body)
  const first = Array.isArray(input.errors) ? asRecord(input.errors[0]) : {}
  const code = asRecord(first.context).code ?? input.error ?? input.code
  return compact({ status, code: typeof code === 'string' ? code : undefined })
}

function portfolioQuery(query: Record<string, string>) {
  const tokens: Record<string, string[]> = {}
  for (const entry of (query.tokens ?? '').split(',').filter(Boolean)) {
    const separator = entry.lastIndexOf(':')
    const chain = String(chainIdNumber(entry.slice(0, separator)))
    tokens[chain] ??= []
    tokens[chain].push(entry.slice(separator + 1).toLowerCase())
  }
  return compact({
    chainIds: query.chainIds
      ? query.chainIds.split(',').filter(Boolean).map(chainIdNumber)
      : undefined,
    tokens: Object.keys(tokens).length > 0 ? tokens : undefined,
  })
}

const alps: VersionAdapter = {
  apiVersion: 'alps',
  quoteRequest,
  submitRequest,
  cost,
  wireError,
  readParams(op, { path, query, body }) {
    switch (op) {
      case 'status':
        return { intentId: decodeURIComponent(path.split('/').pop() ?? '') }
      case 'portfolio':
        return compact({
          account: decodeURIComponent(path.split('/')[2] ?? '').toLowerCase(),
          ...portfolioQuery(query),
        })
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
    const nonce = asRecord(asRecord(body).signedIntentOp).nonce
    return {
      status: 200,
      body: { result: { id: String(nonce), status: 'PENDING' } },
    }
  },
}

export { alps, portfolioQuery, tokenAmountRecord }
