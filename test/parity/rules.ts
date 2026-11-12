import type { Layer } from './canonical/types'

// Every rule names what varies and why. Add one only for variance a repeated
// baseline-vs-baseline run shows, scoped to the narrowest path.

type RuleKind = 'mask' | 'tolerance' | 'ignore' | 'decodeCalldata'

interface Tolerance {
  relative?: number
  absolute?: number
  // Zero and non-zero never match, so a fee category cannot appear or vanish.
  presence?: boolean
}

interface Rule extends Tolerance {
  id: string
  layer: Layer | '*'
  // JSON-pointer glob within the layer: `*` is one segment, `**` any number,
  // `(a|b)` alternates within a segment.
  path: string
  kind: RuleKind
  label?: string
  reason: string
}

const AMOUNT_TOLERANCE = 0.02

const RULES: Rule[] = [
  {
    id: 'trace-id',
    layer: '*',
    path: '**/traceId',
    kind: 'ignore',
    reason: 'Per-request server trace id.',
  },
  {
    id: 'typed-data.nonce',
    layer: 'typedData',
    path: '**/message/**/(nonce|targetExecutionNonce)',
    kind: 'mask',
    label: 'nonce',
    reason: 'The orchestrator allocates a fresh intent nonce per quote.',
  },
  {
    id: 'typed-data.time',
    layer: 'typedData',
    path: '**/message/**/(expires|fillDeadline|deadline)',
    kind: 'mask',
    label: 'time',
    reason: 'Expiry and fill deadlines are derived from the quote time.',
  },
  {
    id: 'typed-data.gas-refund',
    layer: 'typedData',
    path: '**/gasRefund/(exchangeRate|overhead)',
    kind: 'tolerance',
    relative: AMOUNT_TOLERANCE,
    reason:
      'Gas refund exchange rate and overhead follow live gas and token prices.',
  },
  {
    id: 'typed-data.op-calldata',
    layer: 'typedData',
    path: '**/ops/*/data',
    kind: 'decodeCalldata',
    relative: AMOUNT_TOLERANCE,
    reason:
      'Origin-op amounts (ERC-20 approve/transfer, CCTP burn amount and max fee) are price-derived; the function and other arguments stay exact.',
  },
  {
    id: 'typed-data.source-amounts',
    layer: 'typedData',
    path: '**/(idsAndAmounts|spendTokens)/*/1',
    kind: 'tolerance',
    relative: AMOUNT_TOLERANCE,
    reason: 'Source-side amounts include price-derived fees.',
  },
  {
    id: 'steps.submit-id',
    layer: 'steps',
    path: '*/value/id',
    kind: 'mask',
    label: 'intent-id',
    reason: 'The submit result id is the per-quote intent nonce.',
  },
  {
    id: 'cost.inputs',
    layer: 'cost',
    path: '*/inputs/*/amount',
    kind: 'tolerance',
    relative: 0.05,
    reason: 'Input amounts include fees priced at quote time.',
  },
  {
    id: 'cost.fees-usd',
    layer: 'cost',
    path: '*/fees/(gas|bridge|swap|app|protocol)/usd',
    kind: 'tolerance',
    relative: 0.1,
    absolute: 0.02,
    presence: true,
    reason:
      'USD fees follow live gas and token prices; whether a category is charged must match.',
  },
  {
    id: 'cost.total-usd',
    layer: 'cost',
    path: '*/fees/totalUsd',
    kind: 'tolerance',
    relative: 0.1,
    absolute: 0.02,
    presence: true,
    reason: 'Total USD fee follows live prices.',
  },
  {
    id: 'cost.version-only',
    layer: 'cost',
    path: '*/versionOnly',
    kind: 'ignore',
    reason:
      'Categories only one API version reports; the total already covers them.',
  },
]

export type { Rule, RuleKind, Tolerance }
export { RULES }
