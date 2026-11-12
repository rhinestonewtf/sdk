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

const ACCEPTED: AcceptedDifference[] = []

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
export { ACCEPTED, applyAccepted }
