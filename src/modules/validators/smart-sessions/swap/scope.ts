import type { Abi, Address } from 'viem'
import type {
  FyndVenue,
  Permission,
  ScopedAction,
  SwapScopeInput,
  SwapVenue,
  ZeroExVenue,
} from '../types'
import { type FyndChainId, scopeFynd } from './fynd'
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
  :
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
    ...new Set(scopings.map((s) => s.approveSpender.toLowerCase())),
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
): ResolvedSwapScope {
  if (scope.via.length === 0) {
    throw new Error(
      'swap.via must list at least one venue — an empty list would authorise nothing',
    )
  }
  if (scope.sell.token.toLowerCase() === scope.buy.token.toLowerCase()) {
    throw new Error(
      `swap.sell.token and swap.buy.token are the same address (${scope.sell.token})`,
    )
  }

  const scopings = scope.via.map((venue) => {
    // A venue-level cap wins over the scope-level one: `anySettler` demands its
    // own `maxSpend` precisely because that venue needs a tighter bound than the
    // session as a whole might carry.
    const ctx = {
      chainId,
      sellToken: scope.sell.token,
      buyToken: scope.buy.token,
      recipient: scope.to,
      cap: venue.maxSpend ?? scope.sell.maxTotal,
    }
    return venue.id === '0x' ? scopeZeroEx(venue, ctx) : scopeFynd(ctx)
  })

  return {
    permissions: [approvePermission(scope, scopings)],
    actions: scopings.map((s) => s.action),
  }
}
