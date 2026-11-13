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
    // On every quote step, so by field name.
    layer: 'quoteRequest',
    path: '/*/options/topupCompact',
    reason:
      'v1 no longer sends options.topupCompact (lockFunds): neither API version defines it, the orchestrator discards it on both, and blanc sponsorship binding refuses unknown options.',
  },
  {
    layer: 'quoteRequest',
    scenario: 'mapping/cross-chain-options',
    path: '/fee-asset/options/feeToken',
    reason:
      'v1 no longer sends options.feeToken (feeAsset): neither API version defines it and the orchestrator discards it on both.',
  },
  {
    layer: 'errors',
    scenario: 'errors/quote-rejections',
    path: '/unsupported-token/message',
    reason:
      'Quotes go through blanc, which names the chain in CAIP-2 form ("on chain eip155:421614"). Class, status, type and context are unchanged; the SDK does not rewrite server text.',
  },
  {
    layer: 'errors',
    scenario: 'errors/quote-rejections',
    path: '/unsupported-chain/context/path',
    reason:
      'Blanc rejects an unknown destination chain in its chain-id validator, which reports no field path; v1 still raises UnsupportedChainIdError 400.',
  },
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
  {
    layer: 'errors',
    scenario: 'errors/reads',
    path: '/splits-unsupported-chain/message',
    reason:
      'Splits now go through blanc, whose chain-id validator words an unknown chain differently ("unknown eip155 reference", CAIP-2 form). Class, status, error type and context are unchanged; the SDK does not rewrite server text.',
  },
  {
    layer: 'errors',
    scenario: 'reads/client',
    path: '/portfolio-unknown-chain/message',
    reason:
      'Portfolio filters now go through blanc, whose chain-id validator words an unknown chain differently. Class, status, error type and context are unchanged.',
  },
]

const TARGET_EXECUTION_UNREAD =
  'The orchestrator serves no target-execution payload on IntentExecutor routes and never reads one there; 1.22.0 signed an unused one, and the intent completes without it.'

const CCTP_RELAYER_DELIVERY =
  "The orchestrator delivers this sponsored CCTP burn through Rhinestone's relayer on blanc (Circle forwarding on alps), which changes the burn's amount, fee cap and hook data and the route's total cost; the plan is chosen by API version, not by v1."

// Scenario-local entries, each one exact path; the scenarios reference them.
const SCENARIO_ACCEPTED: Record<string, AcceptedDifference[]> = {
  'funded/session-verify-executions': [
    {
      layer: 'typedData',
      path: '/signedRaw/4',
      reason: TARGET_EXECUTION_UNREAD,
    },
    {
      layer: 'signatures',
      path: '/sign/targetExecution',
      reason: TARGET_EXECUTION_UNREAD,
    },
    {
      layer: 'submitRequest',
      path: '/submit/signatures/targetExecution',
      reason: TARGET_EXECUTION_UNREAD,
    },
  ],
  'funded/cctp-safe': [
    ...[
      '/public/messages/0',
      '/public/messages/1',
      '/signed/0',
      '/signed/1',
      '/signed/2',
    ].flatMap((payload) =>
      [
        '/message/op/ops/0/data/$calldata/args/amount',
        '/message/op/ops/1/data/$calldata/args/amount',
        '/message/op/ops/1/data/$calldata/args/maxFee',
        '/message/op/ops/1/data/$calldata/args/hookData',
      ].map(
        (field): AcceptedDifference => ({
          layer: 'typedData',
          path: `${payload}${field}`,
          reason: CCTP_RELAYER_DELIVERY,
        }),
      ),
    ),
    {
      layer: 'cost',
      path: '/prepare/fees/totalUsd',
      reason: CCTP_RELAYER_DELIVERY,
    },
  ],
}

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
export { ACCEPTED, applyAccepted, assertExactErrorEntries, SCENARIO_ACCEPTED }
