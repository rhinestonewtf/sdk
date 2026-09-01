import { type Address, type Chain, toFunctionSelector } from 'viem'
import type {
  ArgPolicyExpression,
  FyndVenue,
  Policy,
  RhinestoneSwapVenue,
  RoutedRhinestoneSwapVenue,
  ScopedAction,
  Session,
  SwapScope,
  SwapVenue,
  UniversalActionPolicyParamRule,
  ZeroExVenue,
} from '../../../../types'
import { type FyndChainId, scopeFynd } from './fynd'
import { rhinestoneSwap, scopeRhinestone } from './rhinestone'
import type { VenueScoping } from './rules'
import { pin } from './rules'
import { scopeZeroEx, type ZeroExChainId } from './zero-ex'

export type SwapVenueFor<TChainId extends number> = number extends TChainId
  ? SwapVenue
  :
      | RhinestoneSwapVenue
      | (TChainId extends ZeroExChainId ? ZeroExVenue : never)
      | (TChainId extends FyndChainId ? FyndVenue : never)

export type SwapScopeFor<TChainId extends number> = Omit<SwapScope, 'via'> & {
  readonly via?: readonly SwapVenueFor<TChainId>[]
}

export interface ResolvedSwapScope {
  readonly actions: ScopedAction[]
}

/** Preserve the session chain literal so unavailable venues fail at compile time. */
export function toSession<const TChain extends Chain>(
  session: Omit<Session, 'chain' | 'swap'> & {
    readonly chain: TChain
    readonly swap: SwapScopeFor<TChain['id']>
  },
): Session {
  return session
}

const APPROVE_SELECTOR = toFunctionSelector('approve(address,uint256)')

function orRules(rules: UniversalActionPolicyParamRule[]): ArgPolicyExpression {
  return rules
    .map((rule): ArgPolicyExpression => ({ type: 'rule', rule }))
    .reduceRight((right, left) => ({ type: 'or', left, right }))
}

function approveAction(
  scope: SwapScope,
  scopings: VenueScoping[],
): ScopedAction {
  const spenders = [
    ...new Set(
      scopings.flatMap((scoping) =>
        scoping.approveSpenders.map((spender) => spender.toLowerCase()),
      ),
    ),
  ].map((spender) => spender as Address)

  const rules = spenders.map((spender) => pin(0n, spender))
  const spenderPolicy: Policy =
    rules.length === 1
      ? {
          type: 'universal-action',
          valueLimitPerUse: 0n,
          rules: [rules[0]],
        }
      : {
          type: 'arg-policy',
          valueLimitPerUse: 0n,
          expression: orRules(rules),
        }
  const policies: Policy[] = [spenderPolicy]
  if (scope.sell.maxTotal !== undefined) {
    policies.push({
      type: 'spending-limits',
      limits: [{ token: scope.sell.token, amount: scope.sell.maxTotal }],
    })
  }

  return { target: scope.sell.token, selector: APPROVE_SELECTOR, policies }
}

export function resolveSwapScope(
  scope: SwapScope,
  chainId: number,
  environment: 'production' | 'development' = 'production',
): ResolvedSwapScope {
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

  const contextFor = (venue: { maxSpend?: bigint }) => ({
    chainId,
    environment,
    sellToken: scope.sell.token,
    buyToken: scope.buy.token,
    recipient: scope.to,
    cap: venue.maxSpend ?? scope.sell.maxTotal,
  })

  const routes = new Set(
    via.flatMap((venue) =>
      venue.id === 'fynd'
        ? ['fynd' as const]
        : venue.id === '0x'
          ? ['zeroEx' as const]
          : [],
    ),
  )
  const anyAggregatorAllowed = via.some((venue) => venue.id === 'rhinestone')
  const sharedRoute =
    routes.size === 1 && !anyAggregatorAllowed ? [...routes][0] : undefined
  const sharedRoutes =
    routes.size > 1 && !anyAggregatorAllowed ? [...routes] : undefined
  const zeroExSettler = via.flatMap((venue) =>
    venue.id === '0x' && venue.settler !== undefined ? [venue.settler] : [],
  )[0]

  const wrappedVenue = (): RoutedRhinestoneSwapVenue => {
    const settler = zeroExSettler ? { settler: zeroExSettler } : {}
    if (sharedRoutes) {
      return { id: 'rhinestone', routes: sharedRoutes, ...settler }
    }
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
    const context = contextFor(venue)
    if (venue.id === 'rhinestone') return scopeRhinestone(venue, context)

    const parts = [
      venue.id === 'fynd' ? scopeFynd(context) : scopeZeroEx(venue, context),
      scopeRhinestone(wrappedVenue(), context),
    ]
    return {
      approveSpenders: parts.flatMap((part) => [...part.approveSpenders]),
      actions: parts.flatMap((part) => [...part.actions]),
    }
  })

  return {
    actions: [
      approveAction(scope, scopings),
      ...dedupeActions(scopings.flatMap((scoping) => [...scoping.actions])),
    ],
  }
}

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
