import {
  alpsCategoryFee,
  alpsWireCode,
  amount,
  asRecord,
  authorization,
  chainIdNumber,
  compact,
  filterList,
  lowerHex,
  mapChainKeys,
  quoteRequest,
  requestSponsorship,
  signatureModeNumber,
  sortCostTokens,
  sumAmounts,
  tokenAmountRecord,
} from './common'
import type {
  CanonicalCost,
  CanonicalSubmitRequest,
  VersionAdapter,
} from './types'

// Version `2026-01.alps`: what v1 1.22.0 speaks.

// The orchestrator lowers alps's flat exact-input list to per-chain tokens
// (deduplicated, first-seen order) plus the amounts of the entries that carry
// one (`alpsQuoteBodyToInternal`); project what it plans from.
function accessList(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    const chainTokens: Record<string, string[]> = {}
    const chainTokenAmounts: Record<string, Record<string, string>> = {}
    for (const entry of value) {
      const item = asRecord(entry)
      const chain = String(chainIdNumber(item.chainId))
      const token = String(item.tokenAddress).toLowerCase()
      chainTokens[chain] ??= []
      if (!chainTokens[chain].includes(token)) chainTokens[chain].push(token)
      const itemAmount = amount(item.amount)
      if (itemAmount !== undefined) {
        chainTokenAmounts[chain] ??= {}
        chainTokenAmounts[chain][token] = itemAmount
      }
    }
    return compact({
      chainTokens,
      chainTokenAmounts:
        Object.keys(chainTokenAmounts).length > 0
          ? chainTokenAmounts
          : undefined,
    })
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

// The orchestrator folds alps's singular mock signature into the cross-chain
// fallback `mockSignatures['0']` unless that is set; project what it plans
// from.
function foldMockSignature(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const { mockSignature, ...rest } = asRecord(value)
  if (mockSignature === undefined) return value
  const mockSignatures = asRecord(rest.mockSignatures)
  return {
    ...rest,
    mockSignatures:
      '0' in mockSignatures
        ? mockSignatures
        : { ...mockSignatures, '0': mockSignature },
  }
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

function cost(
  responseBody: unknown,
  requestBody: unknown,
): CanonicalCost | undefined {
  const intentCost = asRecord(responseBody).intentCost
  if (!intentCost) return undefined
  const request = asRecord(requestBody)
  const destinationChainId = chainIdNumber(request.destinationChainId)
  const sponsored = requestSponsorship(requestBody)
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
      gas: alpsCategoryFee(usd.gasFeeUSD, sponsored.gas),
      // Blanc has no settlement category; the settlement layer's fee is
      // part of what it reports as the bridge fee.
      bridge: alpsCategoryFee(
        (usd.bridgeFeeUSD ?? 0) + (usd.settlementFeeUSD ?? 0),
        sponsored.bridge,
      ),
      swap: alpsCategoryFee(usd.swapFeeUSD, sponsored.swap),
      app: alpsCategoryFee(usd.appFeeUSD, sponsored.app),
      protocol: alpsCategoryFee(usd.protocolFeeUSD, sponsored.protocol),
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
  return compact({ status, code: alpsWireCode(body) })
}

const alps: VersionAdapter = {
  quoteRequest: (body) =>
    quoteRequest(
      compact({
        ...asRecord(body),
        account: foldMockSignature(asRecord(body).account),
        recipient: foldMockSignature(asRecord(body).recipient),
      }),
      {
        gasLimitKey: 'destinationGasUnits',
        accessList,
        options,
      },
    ),
  submitRequest,
  cost,
  wireError,
  submitStub(body) {
    const nonce = asRecord(asRecord(body).signedIntentOp).nonce
    return {
      status: 200,
      body: { result: { id: String(nonce), status: 'PENDING' } },
    }
  },
  submittedIntentId(responseBody) {
    const id = asRecord(asRecord(responseBody).result).id
    return id === undefined || id === null ? undefined : String(id)
  },
}

export { alps }
