import type { Layer } from './canonical/types'
import type { Diff } from './compare'
import { matchGlob } from './glob'

// A difference the migration intends. Each entry needs a reason and is
// listed in the report under its own heading.
interface AcceptedDifference {
  layer: Layer
  path: string
  scenario?: string
  reason: string
}

const LIQUIDITY_TRACE_ID =
  'The candidate reads the trace id from the x-trace-id header; the alps liquidity body has none, so 1.22.0 reports an empty trace id.'

// Entries on the errors layer name one scenario and one exact path: never a
// glob over messages or contexts. The runner checks every entry it merges,
// scenario-local ones included; accepted.test.ts checks this list needs a scenario.
const ACCEPTED: AcceptedDifference[] = [
  {
    layer: 'errors',
    scenario: 'errors/reads',
    path: '/splits-insufficient-liquidity/hasTraceId',
    reason: LIQUIDITY_TRACE_ID,
  },
  {
    // Fires only while this split fails for liquidity.
    layer: 'errors',
    scenario: 'reads/splits',
    path: '/splits-settlement-layers/hasTraceId',
    reason: LIQUIDITY_TRACE_ID,
  },
]

// Every glob construct glob.ts supports: wildcards and alternation.
const GLOB_CHARS = /[*(|)]/

function assertExactErrorEntries(entries: AcceptedDifference[]): void {
  for (const entry of entries) {
    if (entry.layer !== 'errors') continue
    if (GLOB_CHARS.test(entry.path) || GLOB_CHARS.test(entry.scenario ?? '')) {
      throw new Error(
        `Accepted difference on the errors layer must be exact, not a glob: ${entry.scenario ?? '(scenario)'} ${entry.path}`,
      )
    }
  }
}

function applyAccepted(
  diffs: Diff[],
  scenarioId: string,
  entries: AcceptedDifference[],
): { unaccepted: Diff[]; accepted: (Diff & { reason: string })[] } {
  const unaccepted: Diff[] = []
  const accepted: (Diff & { reason: string })[] = []
  for (const diff of diffs) {
    const entry = entries.find(
      (candidate) =>
        candidate.layer === diff.layer &&
        (!candidate.scenario || matchGlob(candidate.scenario, scenarioId)) &&
        matchGlob(candidate.path, diff.path),
    )
    if (entry) accepted.push({ ...diff, reason: entry.reason })
    else unaccepted.push(diff)
  }
  return { unaccepted, accepted }
}

export type { AcceptedDifference }
export { ACCEPTED, applyAccepted, assertExactErrorEntries }
