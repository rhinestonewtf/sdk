import type { Session } from '../../modules/validators/smart-sessions/types'
import { sessionChains } from './sessions'
import type { IntentInput, IntentOptions } from './types'

type LayerFilter = NonNullable<IntentOptions['settlementLayers']>
type Layer = Extract<LayerFilter, { include: unknown }>['include'][number]
type QuoterFilter = NonNullable<IntentOptions['quoters']>
type Quoter = Extract<QuoterFilter, { include: unknown }>['include'][number]

/** Narrows the explicit source and global route filters before the quote is bound. */
export function constrainSessionIntent<C>(
  intent: IntentInput<C>,
  account: string,
  participatingChainIds?: readonly number[],
): IntentInput<C> {
  if (intent.signers?.kind !== 'smart-session') return intent
  const chainIds = new Set(
    participatingChainIds ??
      sessionChains(intent, account).map((chain) => chain.id),
  )
  const sessions = Object.entries(intent.signers.byChain)
    .filter(([id]) => chainIds.has(Number(id)))
    .map(([, selected]) => selected.session)
  let source = intent.source
  if (source) {
    const origin = intent.signers.byChain[source.chain.id]?.session
    if (origin?.permit2Sources?.length) {
      const sameChain =
        intent.destination.kind === 'evm' &&
        intent.destination.id === source.chain.id
      if (sameChain && !origin.swap)
        throw new Error(
          'A scoped Permit2 session without a swap scope settles cross-chain intents only',
        )
      const legs =
        sameChain && origin.swap
          ? (
              origin.swap.sell.tokens ??
              (origin.swap.sell.token ? [origin.swap.sell.token] : [])
            ).map((token) => ({
              chain: origin.chain,
              token,
              maxAmount: origin.swap!.sell.maxTotal,
            }))
          : origin.permit2Sources
      const leg = legs.find(
        (leg) =>
          leg.chain.id === source!.chain.id &&
          leg.token.toLowerCase() === source!.token.toLowerCase(),
      )
      if (!leg)
        throw new Error(
          'The explicit source token is outside the session funding scope',
        )
      if (leg.maxAmount !== undefined)
        source = {
          ...source,
          maxAmount:
            source.maxAmount === undefined || source.maxAmount > leg.maxAmount
              ? leg.maxAmount
              : source.maxAmount,
        }
    }
  }
  const settlementLayers = settlementPin(
    sessions,
    intent.options?.settlementLayers,
  )
  const quoters = quoterPin(sessions, intent.options?.quoters)
  if (
    participatingChainIds &&
    quoters &&
    'include' in quoters &&
    !quoters.include.length
  )
    throw new Error(
      'quoters: no quoter is compatible with the participating smart sessions. Prepare a fresh transaction with compatible grants and route filters.',
    )
  return {
    ...intent,
    ...(source ? { source } : {}),
    options: {
      ...intent.options,
      ...(settlementLayers ? { settlementLayers } : {}),
      ...(quoters ? { quoters } : {}),
    },
  }
}

function settlementPin(
  sessions: readonly Session[],
  explicit?: LayerFilter,
): LayerFilter | undefined {
  const includes: Set<Layer>[] = []
  const excluded = new Set<Layer>()
  for (const session of sessions) {
    const named = session.settlementLayers ?? []
    if (
      named.some((layer) => ['SAME_CHAIN', 'ECO', 'ACROSS'].includes(layer)) &&
      session.access?.kind !== 'scoped'
    ) {
      if (!named.includes('ACROSS')) excluded.add('ACROSS')
      continue
    }
    const layers = named.flatMap((layer): Layer[] =>
      layer === 'SAME_CHAIN_IE' || layer === 'SAME_CHAIN'
        ? []
        : [layer === 'ECO_IE' ? 'ECO' : (layer as Layer)],
    )
    if (layers.length) includes.push(new Set(layers))
  }
  if (!includes.length) {
    if (!excluded.size) return explicit
    if (!explicit || 'exclude' in explicit)
      return {
        exclude: [...new Set([...(explicit?.exclude ?? []), ...excluded])],
      }
    const include = explicit.include.filter((layer) => !excluded.has(layer))
    if (!include.length)
      throw new Error(
        'settlementLayers: no settlement layer is left to settle the intent',
      )
    return { include }
  }
  const derived = [...includes[0]!].filter(
    (layer) =>
      !excluded.has(layer) && includes.every((layers) => layers.has(layer)),
  )
  const include = !explicit
    ? derived
    : 'include' in explicit
      ? derived.filter((layer) => explicit.include.includes(layer))
      : derived.filter((layer) => !explicit.exclude.includes(layer))
  if (!include.length)
    throw new Error(
      'settlementLayers: no settlement layer is left to settle the intent',
    )
  return { include }
}

function quoterPin(
  sessions: readonly Session[],
  explicit?: QuoterFilter,
): QuoterFilter | undefined {
  let pinned: Set<Quoter> | undefined
  for (const session of sessions) {
    const via = session.swap?.via
    if (!via?.length) continue
    const venues = new Set<Quoter>()
    let unconstrained = false
    for (const venue of via) {
      if (venue.id === '0x') venues.add('0x')
      else if (venue.id === 'fynd') venues.add('fynd')
      else if (
        venue.id === 'rhinestone' &&
        'route' in venue &&
        venue.route === 'zeroEx'
      )
        venues.add('0x')
      else if (
        venue.id === 'rhinestone' &&
        'route' in venue &&
        venue.route === 'fynd'
      )
        venues.add('fynd')
      else unconstrained = true
    }
    if (unconstrained) continue
    pinned = pinned
      ? new Set([...pinned].filter((quoter) => venues.has(quoter)))
      : venues
  }
  if (!pinned) return explicit
  const include = !explicit
    ? [...pinned]
    : 'include' in explicit
      ? explicit.include.filter((quoter) => pinned.has(quoter))
      : [...pinned].filter((quoter) => !explicit.exclude.includes(quoter))
  return { include }
}
