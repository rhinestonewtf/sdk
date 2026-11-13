// Blanc read responses rebuilt into the alps shapes v1 has always returned.
// Ports the orchestrator's own alps lowering (toAlpsIntentStatus,
// toAlpsPortfolio), quirks included, so results don't change.
import type { Address } from 'viem'
import type { IntentOpStatus, IntentRefund, Portfolio } from './types'
import { caipChainIdsToNumbers } from './wire-error'

type Claim = IntentOpStatus['claims'][number]

interface BlancOperationItem {
  type: string
  status: string
  txHash?: string
  timestamp?: number
}

interface BlancIntentStatus {
  status: IntentOpStatus['status']
  accountAddress: Address
  operations?: { chain: number | string; items: BlancOperationItem[] }[]
  refunds?: IntentRefund[]
}

interface BlancPortfolio {
  portfolio: {
    symbol: string
    chains: {
      chainId: string | number
      address: Address
      decimals: number
      amount: string
    }[]
  }[]
}

interface PortfolioFilter {
  chainIds?: number[]
  tokens?: { [chainId: number]: Address[] }
}

function toCaip2(chainId: number | string): string {
  return `eip155:${chainId}`
}

function chainNumber(chain: number | string): number {
  return caipChainIdsToNumbers(chain) as number
}

// Alps omits absent fields; a key holding `undefined` would differ for `in`
// checks and spreads.
function omitUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
}

// Blanc rejects an empty `chainIds=`, which alps read as no filter, so an
// empty list emits no param.
function blancPortfolioQuery(filter?: PortfolioFilter): URLSearchParams {
  const params = new URLSearchParams()
  for (const chainId of filter?.chainIds ?? []) {
    params.append('chainIds', toCaip2(chainId))
  }
  for (const [chainId, tokens] of Object.entries(filter?.tokens ?? {})) {
    for (const token of tokens) {
      params.append('tokens', `${toCaip2(chainId)}:${token}`)
    }
  }
  return params
}

function isFill(item: BlancOperationItem): boolean {
  return item.type === 'FILL' || item.type === 'BRIDGE_FILL'
}

function toClaim(chain: number | string, item: BlancOperationItem): Claim {
  return omitUndefined({
    chainId: chainNumber(chain),
    status: item.status,
    claimTimestamp: item.timestamp,
    claimTransactionHash: item.txHash,
  }) as unknown as Claim
}

function intentOpStatusFromBlanc(body: BlancIntentStatus): IntentOpStatus {
  const operations = body.operations ?? []
  const claims: Claim[] = []
  let destinationChainId: number | undefined
  let fillTimestamp: number | undefined
  let fillTransactionHash: string | undefined

  // Mirrors the orchestrator's alps lowering: a single group of only CLAIMs
  // has no destination yet.
  const onlyClaims =
    operations.length === 1 &&
    operations[0].items.length > 0 &&
    operations[0].items.every((item) => item.type === 'CLAIM')

  if (onlyClaims) {
    for (const item of operations[0].items) {
      claims.push(toClaim(operations[0].chain, item))
    }
  } else if (operations.length === 1) {
    // Mirrors the alps lowering: a single group is the fill, read from its
    // first item whatever its type.
    destinationChainId = chainNumber(operations[0].chain)
    const fillItem = operations[0].items[0]
    fillTimestamp = fillItem?.timestamp
    fillTransactionHash = fillItem?.txHash
  } else {
    const hasTypedFill = operations.some((group) => group.items.some(isFill))
    for (let i = 0; i < operations.length; i++) {
      const group = operations[i]
      const fillItem = group.items.find(isFill)
      // Mirrors the alps lowering: without a typed fill the last group is the
      // fill; with several typed fills the last one wins, and other items on
      // the fill chain are dropped.
      const isFillChain = hasTypedFill
        ? fillItem !== undefined
        : i === operations.length - 1
      if (isFillChain) {
        destinationChainId = chainNumber(group.chain)
        const resolved = fillItem ?? group.items[0]
        if (resolved) {
          fillTimestamp = resolved.timestamp
          fillTransactionHash = resolved.txHash
        }
      } else {
        for (const item of group.items) claims.push(toClaim(group.chain, item))
      }
    }
  }

  return omitUndefined({
    status: body.status,
    claims,
    destinationChainId,
    fillTimestamp,
    fillTransactionHash,
    userAddress: body.accountAddress,
    refunds: body.refunds,
  }) as IntentOpStatus
}

function portfolioFromBlanc(body: BlancPortfolio): Portfolio {
  return body.portfolio.map((entry) => ({
    symbol: entry.symbol,
    // Mirrors the alps lowering: the first chain's decimals, and a raw sum of
    // the per-chain amounts. Blanc has no locked balance; alps reports zero.
    decimals: entry.chains[0]?.decimals ?? 0,
    balances: {
      locked: 0n,
      unlocked: entry.chains.reduce(
        (sum, chain) => sum + BigInt(chain.amount),
        0n,
      ),
    },
    chains: entry.chains.map((chain) => ({
      chain: chainNumber(chain.chainId),
      address: chain.address,
      locked: 0n,
      unlocked: BigInt(chain.amount),
    })) as [
      {
        isAccountDeployed: boolean
        chain: number
        address: Address
        locked: bigint
        unlocked: bigint
      },
    ],
  }))
}

export type { BlancIntentStatus, BlancPortfolio }
export {
  blancPortfolioQuery,
  intentOpStatusFromBlanc,
  portfolioFromBlanc,
  toCaip2,
}
