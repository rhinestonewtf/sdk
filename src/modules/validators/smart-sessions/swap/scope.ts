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

  const ctxFor = (venue: { maxSpend?: bigint }) => ({
    chainId,
    environment,
    sellToken: scope.sell.token,
    buyToken: scope.buy.token,
    recipient: scope.to,
    // A venue-level cap wins over the scope-level one: `anySettler` demands its
    // own `maxSpend` precisely because that venue needs a tighter bound than the
    // session as a whole might carry.
    cap: venue.maxSpend ?? scope.sell.maxTotal,
  })

  // Every aggregator venue is reachable two ways and the orchestrator picks:
  // it wraps a route in the Swapper only when the Swapper can capture surplus,
  // which depends on the direction AND the winning quoter, and that eligibility
  // is orchestrator-side config that changes without the session knowing. So
  // each venue authorises its direct call AND the wrapped one; authorising a
  // single shape is how a session rejects the swap it was created for.
  //
  // The wrapped shape pins which aggregator may sit in the Swapper's `calls[]`.
  // Two venues pinning DIFFERENT aggregators cannot share one Swapper action —
  // so with more than one aggregator authorised the tail is left unpinned,
  // which is the honest reading: either aggregator may fill it. The swap stays
  // bound by the Swapper's own top-level tokenIn/tokenOut/recipient pins and
  // the sell cap either way.
  const routes = new Set(
    via.flatMap((venue) =>
      venue.id === 'fynd'
        ? ['fynd' as const]
        : venue.id === '0x'
          ? ['zeroEx' as const]
          : [],
    ),
  )
  // A bare `rhinestoneSwap()` authorises any aggregator in the tail, so pinning
  // it for the others would both contradict that venue and collide with it on
  // the same Swapper action.
  const anyAggregatorAllowed = via.some(
    (venue) => venue.id === 'rhinestone' && venue.route === undefined,
  )
  const sharedRoute =
    routes.size === 1 && !anyAggregatorAllowed ? [...routes][0] : undefined
  // More than one aggregator authorised: pin the tail to ANY ONE of them rather
  // than to none. Sharing the Swapper action by dropping its route pins would
  // authorise a tail neither venue named, which is broader than the scope.
  const sharedRoutes =
    routes.size > 1 && !anyAggregatorAllowed ? [...routes] : undefined
  // The Settler the 0x venue already carries, so the wrapped half can pin the
  // nested exec instead of dropping the one address that makes it bindable.
  const zeroExSettler = via.flatMap((venue) =>
    venue.id === '0x' && venue.settler !== undefined ? [venue.settler] : [],
  )[0]
  const wrappedVenue = (): RhinestoneSwapVenue => {
    const settler =
      zeroExSettler !== undefined ? { settler: zeroExSettler } : {}
    if (sharedRoutes)
      return { id: 'rhinestone', routes: sharedRoutes, ...settler }
    if (sharedRoute) {
      return {
        id: 'rhinestone',
        route: sharedRoute,
        ...(sharedRoute === 'zeroEx' ? settler : {}),
      }
    }
    return { id: 'rhinestone' }
  }

  const scopings = via.map((venue): VenueScoping => {
    const ctx = ctxFor(venue)
    if (venue.id === 'rhinestone') {
      return scopeRhinestone(
        venue.route === 'zeroEx' && venue.settler === undefined && zeroExSettler
          ? { ...venue, settler: zeroExSettler }
          : venue,
        ctx,
      )
    }

    const parts: VenueScoping[] = [
      venue.id === 'fynd' ? scopeFynd(ctx) : scopeZeroEx(venue, ctx),
      scopeRhinestone(wrappedVenue(), ctx),
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
 * Every aggregator venue covers the Swapper-wrapped shape as well as its direct
 * one, so listing two of them yields the same (target, selector) twice. Those map to one on-chain action id, and the resolver rejects
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
