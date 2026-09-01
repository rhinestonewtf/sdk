import type { Abi, Address } from 'viem'
import type {
  FyndVenue,
  Permission,
  RhinestoneSwapVenue,
  ScopedAction,
  SwapScopeInput,
  SwapVenue,
  ZeroExVenue,
} from '../types'
import { type FyndChainId, scopeFynd } from './fynd'
import { rhinestoneSwap, scopeRhinestone } from './rhinestone'
import type { VenueScoping } from './rules'
import { scopeZeroEx, type ZeroExChainId } from './zero-ex'

/**
 * Venue-scoped swap sessions (RHI-6286).
 *
 * A session scoped with `swap` may do exactly two things: approve the sell token
 * to a listed venue's spender, and call that venue's swap entrypoint with the
 * sell token, buy token and recipient pinned. Everything else reverts.
 *
 * Callers name venues (`zeroEx(...)`, `fynd()`); routers, selectors and calldata
 * offsets live in the per-venue modules and never reach the public surface, so
 * they stay patchable without a breaking change.
 */

/**
 * Venues valid on a given chain.
 *
 * Narrows `swap.via` by the session's chain id, so naming a venue that is not
 * deployed there is a compile error rather than a revert at swap time.
 */
export type SwapVenueFor<TChainId extends number> = number extends TChainId
  ? // The chain id isn't statically known (e.g. a `Chain`-typed variable, or an
    // entry point that doesn't thread the chain generic). Narrowing to the
    // per-chain venues would collapse the union to `never` and reject every
    // venue, so fall back to allowing all of them — `resolveSwapScope` still
    // rejects an undeployed venue at runtime.
    SwapVenue
  : // The Swapper is CREATE2-deployed at one address on every chain, so it is
    // never chain-gated.
      | RhinestoneSwapVenue
      | (TChainId extends ZeroExChainId ? ZeroExVenue : never)
      | (TChainId extends FyndChainId ? FyndVenue : never)

export interface ResolvedSwapScope {
  readonly permissions: Permission[]
  readonly actions: ScopedAction[]
}

const erc20ApproveAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const satisfies Abi

/**
 * One approve permission covering every venue's spender.
 *
 * Merged rather than one-per-venue because all venues pull the same sell token;
 * a single action with a spender allowlist is cheaper to install and keeps the
 * spending-limit a single shared counter instead of one budget per venue.
 */
function approvePermission(
  scope: SwapScopeInput,
  scopings: VenueScoping[],
): Permission {
  const spenders = [
    ...new Set(
      scopings.flatMap((s) => s.approveSpenders.map((a) => a.toLowerCase())),
    ),
  ].map((s) => s as Address)
  return {
    abi: erc20ApproveAbi as unknown as Abi,
    address: scope.sell.token,
    functions: {
      approve: {
        ...(scope.sell.maxTotal !== undefined
          ? {
              spendingLimit: {
                token: scope.sell.token,
                amount: scope.sell.maxTotal,
              },
            }
          : {}),
        params: {
          spender:
            spenders.length === 1
              ? { condition: 'equal', value: spenders[0] }
              : { anyOf: spenders },
        },
      },
    },
  } as Permission
}

/**
 * Compile a `swap` scope into one merged approve permission plus one scoped
 * action per venue.
 */
export function resolveSwapScope(
  scope: SwapScopeInput,
  chainId: number,
  environment: 'production' | 'development' = 'production',
): ResolvedSwapScope {
  // Default to the Swapper: it is the route the orchestrator emits for
  // same-chain smart-account swaps, so a caller who just says "let this key
  // swap A for B" gets a scope that actually matches the resulting ops.
  const via = scope.via ?? [rhinestoneSwap()]
  if (via.length === 0) {
    throw new Error(
      'swap.via must list at least one venue — an empty list would authorise nothing',
    )
  }
  if (scope.sell.token.toLowerCase() === scope.buy.token.toLowerCase()) {
    throw new Error(
      `swap.sell.token and swap.buy.token are the same address (${scope.sell.token})`,
    )
  }

  const scopings = via.map((venue) => {
    // A venue-level cap wins over the scope-level one: `anySettler` demands its
    // own `maxSpend` precisely because that venue needs a tighter bound than the
    // session as a whole might carry.
    const ctx = {
      chainId,
      environment,
      sellToken: scope.sell.token,
      buyToken: scope.buy.token,
      recipient: scope.to,
      cap: venue.maxSpend ?? scope.sell.maxTotal,
    }
    if (venue.id === 'rhinestone') return scopeRhinestone(venue, ctx)
    if (venue.id === 'fynd') return scopeFynd(ctx)

    // A 0x venue authorises two distinct call shapes. Composed here rather than
    // inside either venue module, so neither has to import the other.
    const parts: VenueScoping[] = [
      scopeZeroEx(venue, ctx),
      scopeRhinestone({ id: 'rhinestone', route: 'zeroEx' }, ctx),
    ]
    return {
      approveSpenders: parts.flatMap((p) => [...p.approveSpenders]),
      actions: parts.flatMap((p) => [...p.actions]),
    }
  })

  return {
    permissions: [approvePermission(scope, scopings)],
    actions: dedupeActions(scopings.flatMap((s) => [...s.actions])),
  }
}

/**
 * Collapse actions that different venues both authorise.
 *
 * `zeroEx()` covers the Swapper-wrapped shape as well as the direct one, so
 * listing it alongside `swapperZeroEx()` yields the same (target, selector)
 * twice. Those map to one on-chain action id, and the resolver rejects
 * duplicates — reasonably, since two entries would silently overwrite each
 * other's policies. Identical entries are safe to collapse; genuinely
 * conflicting ones still throw, because picking a winner would silently
 * loosen or tighten a rule the caller wrote.
 */
function dedupeActions(actions: ScopedAction[]): ScopedAction[] {
  const byKey = new Map<string, ScopedAction>()
  for (const action of actions) {
    const key = `${action.target.toLowerCase()}|${action.selector.toLowerCase()}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, action)
      continue
    }
    if (
      JSON.stringify(existing, replaceBigInt) !==
      JSON.stringify(action, replaceBigInt)
    ) {
      throw new Error(
        `Conflicting swap actions for ${action.target} ${action.selector}: ` +
          'two venues authorise the same call with different policies. Give ' +
          'them the same cap, or list only one.',
      )
    }
  }
  return [...byKey.values()]
}

function replaceBigInt(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value
}
