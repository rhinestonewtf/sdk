import type { Address } from 'viem'
import { formatCaip2 } from '../../chains/caip2'
import type { NormalizedAccessList } from '../../clients/orchestrator/normalized'
import type {
  OrchestratorExecution,
  OrchestratorSource,
  OrchestratorSourceLimit,
  OrchestratorSourceSelection,
  OrchestratorTokenSelector,
} from '../../clients/orchestrator/types'

/**
 * The SDK's source policy, in the shape the facade resolves it to. Translated
 * here — once — into Caucasus `source.selection` and `source.limits`.
 *
 * The two express eligibility differently and the difference is dangerous: a
 * Caucasus `limit` caps how much a (chain, token) may contribute and says
 * nothing about whether it is eligible at all, whereas `chainTokenAmounts`
 * both named the pair and capped it. Translating an amount entry to a limit
 * alone would open every other chain and token the account holds.
 */
export type IntentSourcePolicy = NormalizedAccessList

export interface IntentSourceInput {
  readonly policy?: IntentSourcePolicy
  readonly auxiliaryFunds?: Readonly<
    Record<number, Readonly<Record<Address, bigint>>>
  >
  readonly executions?: Readonly<
    Record<number, readonly OrchestratorExecution[]>
  >
}

export function buildIntentSource(
  input: IntentSourceInput,
): OrchestratorSource | undefined {
  const selection = buildSelection(input.policy)
  const limits = buildLimits(input.policy)
  const auxiliaryFunds = input.auxiliaryFunds
    ? mapByCaip2(input.auxiliaryFunds)
    : undefined
  const executions = Object.entries(input.executions ?? {}).map(
    ([chainId, calls]) => ({
      vm: 'evm' as const,
      chainId: formatCaip2(Number(chainId)),
      calls,
    }),
  )
  const source: OrchestratorSource = {
    ...(selection ? { selection } : {}),
    ...(limits.length > 0 ? { limits } : {}),
    ...(auxiliaryFunds ? { auxiliaryFunds } : {}),
    ...(executions.length > 0 ? { executions } : {}),
  }
  return Object.keys(source).length > 0 ? source : undefined
}

function buildSelection(
  policy: IntentSourcePolicy | undefined,
): OrchestratorSourceSelection | undefined {
  if (!policy) return undefined
  const perChainTokens = mergePerChainTokens(policy)
  const namedChains = perChainTokens && [...perChainTokens.keys()]

  // A per-chain map is the whole chain allowlist, not a narrowing of a wider
  // one: an unlisted chain is not eligible, exactly as `chainTokens` meant.
  const chains =
    namedChains !== undefined
      ? { only: namedChains.map(formatCaip2) }
      : policy.chainIds
        ? { only: policy.chainIds.map(formatCaip2) }
        : undefined

  const globalTokens = policy.tokens ? [...policy.tokens] : undefined
  // With a per-chain map, the token dimension IS restricted — to the union of
  // everything named — and `perChain` then narrows each chain to its own list.
  // Sending `'all'` here and relying on `perChain` alone would leave any chain
  // the map does not cover open to every token.
  const tokens = namedChains
    ? { only: [...new Set([...perChainTokens!.values()].flat())] }
    : globalTokens
      ? { only: globalTokens }
      : undefined

  if (!chains && !tokens) return undefined
  return {
    chains: chains ?? 'all',
    tokens: (tokens ?? 'all') as OrchestratorTokenSelector,
    ...(perChainTokens
      ? {
          perChain: Object.fromEntries(
            [...perChainTokens].map(([chainId, list]) => [
              formatCaip2(chainId),
              { tokens: { only: list } },
            ]),
          ),
        }
      : {}),
  }
}

/**
 * The tokens each named chain may be sourced in, unioning the unbounded
 * (`chainTokens`) and capped (`chainTokenAmounts`) entries. Returns `undefined`
 * when the policy names no per-chain restriction at all — which is not the same
 * as naming an empty one, and that distinction is what makes an explicit but
 * empty asset selection fail closed instead of widening to everything.
 */
function mergePerChainTokens(
  policy: IntentSourcePolicy,
): Map<number, string[]> | undefined {
  if (!policy.chainTokens && !policy.chainTokenAmounts) return undefined
  const merged = new Map<number, string[]>()
  const add = (chainId: number, token: string) => {
    const list = merged.get(chainId) ?? []
    if (!list.some((entry) => sameToken(entry, token))) list.push(token)
    merged.set(chainId, list)
  }
  for (const [chainId, tokens] of Object.entries(policy.chainTokens ?? {})) {
    merged.set(Number(chainId), merged.get(Number(chainId)) ?? [])
    for (const token of tokens) add(Number(chainId), token)
  }
  for (const [chainId, amounts] of Object.entries(
    policy.chainTokenAmounts ?? {},
  )) {
    merged.set(Number(chainId), merged.get(Number(chainId)) ?? [])
    for (const token of Object.keys(amounts)) add(Number(chainId), token)
  }
  return merged
}

function buildLimits(
  policy: IntentSourcePolicy | undefined,
): OrchestratorSourceLimit[] {
  const limits: OrchestratorSourceLimit[] = []
  for (const [chainId, amounts] of Object.entries(
    policy?.chainTokenAmounts ?? {},
  )) {
    for (const [tokenAddress, maxAmount] of Object.entries(amounts)) {
      limits.push({
        chainId: formatCaip2(Number(chainId)),
        tokenAddress,
        maxAmount,
      })
    }
  }
  return limits
}

function sameToken(left: string, right: string): boolean {
  return left === right || left.toLowerCase() === right.toLowerCase()
}

function mapByCaip2<T>(
  input: Readonly<Record<number, T>>,
): Readonly<Record<string, T>> {
  return Object.fromEntries(
    Object.entries(input).map(([chainId, value]) => [
      formatCaip2(Number(chainId)),
      value,
    ]),
  )
}
