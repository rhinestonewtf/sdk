import type { Address } from 'viem'
import type { Account, AccountAccessList, IntentInput } from './types'
import { convertBigIntFields } from './utils'
import { toCaip2 } from './wire-read'

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

export { blancQuoteRequest }
