import type { SwapQuoter, SwapQuoterFilter } from '../orchestrator/types'
import type { Session, SignerSet } from '../types'

function venuesForSession(
  session: Session | undefined,
): Set<SwapQuoter> | null {
  const via = session?.swap?.via
  if (!via?.length) return null

  const quoters = new Set<SwapQuoter>()
  for (const venue of via) {
    if (venue.id === '0x') quoters.add('0x')
    else if (venue.id === 'fynd') quoters.add('fynd')
    else if (venue.id === 'rhinestone') return null
    else return null
  }
  return quoters
}

function quoterPinFromSession(
  signers: SignerSet | undefined,
  chainIds: readonly number[],
): SwapQuoterFilter | undefined {
  if (signers?.type !== 'experimental_session') return undefined

  const relevant = new Set(chainIds)
  const sessions =
    'session' in signers
      ? [signers.session]
      : Object.entries(signers.sessions)
          .filter(([chainId]) => relevant.has(Number(chainId)))
          .map(([, config]) => config.session)

  let pinned: Set<SwapQuoter> | null = null
  for (const session of sessions) {
    const venues = venuesForSession(session)
    if (!venues) continue
    if (!pinned) {
      pinned = venues
      continue
    }
    pinned = new Set([...pinned].filter((quoter) => venues.has(quoter)))
  }

  return pinned ? { include: [...pinned] } : undefined
}

function narrowQuoterPin(
  derived: SwapQuoterFilter | undefined,
  explicit: SwapQuoterFilter | undefined,
): SwapQuoterFilter | undefined {
  if (!explicit) return derived
  if (!derived || !('include' in derived)) return explicit

  const allowed = new Set(derived.include)
  const include =
    'include' in explicit
      ? explicit.include.filter((quoter) => allowed.has(quoter))
      : derived.include.filter((quoter) => !explicit.exclude.includes(quoter))
  return { include }
}

export { narrowQuoterPin, quoterPinFromSession, venuesForSession }
