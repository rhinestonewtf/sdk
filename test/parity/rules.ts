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
    path: '**/message/**/(expires|fillDeadline|fillExpiry|deadline)',
    kind: 'mask',
    label: 'time',
    reason:
      'Expiry, fill and permit deadlines are derived from the quote time.',
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
    id: 'typed-data.permit-amounts',
    layer: 'typedData',
    path: '**/message/permitted/*/amount',
    kind: 'tolerance',
    relative: AMOUNT_TOLERANCE,
    reason:
      'Permit2 batch amounts an EOA approves cover the price-derived input; tokens and spender stay exact.',
  },
  {
    id: 'typed-data.origin-op-value',
    layer: 'typedData',
    path: '**/message/mandate/originOps/ops/*/value',
    kind: 'tolerance',
    relative: AMOUNT_TOLERANCE,
    reason:
      'Native input an EOA wraps into WETH before the claim includes price-derived fees (the value steps.intent-op.pre-claim-value covers).',
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
    id: 'steps.intent-op.nonce',
    layer: 'steps',
    path: '*/value/intentRoute/intentOp/(nonce|targetExecutionNonce)',
    kind: 'mask',
    label: 'nonce',
    reason: 'The orchestrator allocates a fresh intent nonce per quote.',
  },
  {
    id: 'steps.intent-op.time',
    layer: 'steps',
    path: '*/value/intentRoute/intentOp/**/(expires|fillDeadline)',
    kind: 'mask',
    label: 'time',
    reason: 'Expiry and fill deadlines are derived from the quote time.',
  },
  {
    id: 'steps.intent-op.server-signature',
    layer: 'steps',
    path: '*/value/intentRoute/intentOp/serverSignature',
    kind: 'mask',
    label: 'server-signature',
    reason: 'The orchestrator signs the per-quote intent op.',
  },
  {
    id: 'steps.intent-op.market',
    layer: 'steps',
    path: '*/value/intentRoute/intentOp/signedMetadata/(gasPrices|tokenPrices)/*',
    kind: 'mask',
    label: 'market',
    reason:
      'Gas and token prices the quote was priced at; which ones are listed stays exact.',
  },
  {
    id: 'steps.intent-op.l1-fees',
    layer: 'steps',
    path: '*/value/intentRoute/intentOp/signedMetadata/opGasParams/*/(l1BaseFee|l1BlobBaseFee)',
    kind: 'mask',
    label: 'market',
    reason:
      'Live L1 base and blob fees observed at quote time; the fee scalars and calldata size stay exact.',
  },
  {
    id: 'steps.intent-op.relayer-quote-id',
    layer: 'steps',
    path: '*/value/intentRoute/intentOp/elements/*/mandate/qualifier/settlementContext/relayerQuotes/*/quoteId',
    kind: 'mask',
    label: 'quote-id',
    reason:
      'The relayer issues a fresh quote id per quote; client and connection ids stay exact.',
  },
  {
    id: 'steps.intent-op.prefund',
    layer: 'steps',
    path: '*/value/intentRoute/intentOp/elements/*/mandate/qualifier/settlementContext/erc20Prefund/*/amount',
    kind: 'tolerance',
    relative: AMOUNT_TOLERANCE,
    reason:
      'The amount prefunded to the relayer on sponsored routes includes price-derived fees.',
  },
  {
    id: 'steps.intent-op.pre-claim-value',
    layer: 'steps',
    path: '*/value/intentRoute/intentOp/elements/*/mandate/preClaimOps/ops/*/value',
    kind: 'tolerance',
    relative: AMOUNT_TOLERANCE,
    reason:
      'Native input wrapped into WETH before the claim includes price-derived fees.',
  },
  {
    id: 'steps.intent-op.gas-refund',
    layer: 'steps',
    path: '*/value/intentRoute/intentOp/**/gasRefund/(exchangeRate|overhead)',
    kind: 'tolerance',
    relative: AMOUNT_TOLERANCE,
    reason:
      'Gas refund exchange rate and overhead follow live gas and token prices.',
  },
  {
    id: 'steps.intent-op.op-calldata',
    layer: 'steps',
    path: '*/value/intentRoute/intentOp/**/ops/*/data',
    kind: 'decodeCalldata',
    relative: AMOUNT_TOLERANCE,
    reason:
      'Origin-op amounts are price-derived; the function and other arguments stay exact.',
  },
  {
    id: 'steps.intent-op.source-amounts',
    layer: 'steps',
    path: '*/value/intentRoute/intentOp/**/(idsAndAmounts|spendTokens)/*/1',
    kind: 'tolerance',
    relative: AMOUNT_TOLERANCE,
    reason:
      'Source-side amounts include price-derived fees (the values typed-data.source-amounts covers).',
  },
  {
    id: 'steps.intent-op.bridge-fill-out',
    layer: 'steps',
    path: '*/value/intentRoute/intentOp/signedMetadata/accounting/bridgeFill/tokensOut/*/amount',
    kind: 'tolerance',
    relative: AMOUNT_TOLERANCE,
    reason:
      'The bridge fill output is rounded from price-derived amounts (a max-out request receives the balance minus fees).',
  },
  {
    id: 'steps.token-requirements.permit-nonce',
    layer: 'steps',
    path: '*/value/intentRoute/tokenRequirements/*/*/permit/message/nonce',
    kind: 'mask',
    label: 'nonce',
    reason:
      'The token’s ERC-2612 nonce advances with every executed permit, so each build’s quote offers the next one.',
  },
  {
    id: 'steps.token-requirements.permit-deadline',
    layer: 'steps',
    path: '*/value/intentRoute/tokenRequirements/*/*/permit/message/deadline',
    kind: 'mask',
    label: 'time',
    reason: 'The ERC-2612 permit deadline is derived from the quote time.',
  },
  {
    id: 'steps.token-requirements',
    layer: 'steps',
    path: '*/value/intentRoute/tokenRequirements/*/*/amount',
    kind: 'tolerance',
    relative: AMOUNT_TOLERANCE,
    reason: 'The required approval covers the price-derived amount spent.',
  },
  {
    id: 'steps.intent-cost.spent',
    layer: 'steps',
    path: '*/value/intentRoute/intentCost/(tokensSpent|tokensReceived)/**/(locked|unlocked|amountSpent)',
    kind: 'tolerance',
    relative: AMOUNT_TOLERANCE,
    reason: 'Amounts spent include fees priced at quote time.',
  },
  {
    id: 'steps.intent-cost.received',
    layer: 'steps',
    path: '*/value/intentRoute/intentCost/tokensReceived/*/destinationAmount',
    kind: 'tolerance',
    relative: AMOUNT_TOLERANCE,
    reason:
      'A max-out request receives the balance minus price-derived fees; requested amounts are compared exactly in quoteRequest.',
  },
  {
    id: 'steps.intent-cost.sponsor-fee',
    layer: 'steps',
    path: '*/value/intentRoute/intentCost/sponsorFee/(protocol|relayer)',
    kind: 'tolerance',
    relative: 0.1,
    presence: true,
    reason:
      'USD sponsor fees follow live gas prices; whether one is charged must match.',
  },
  {
    id: 'steps.intent-op.sponsor-fee',
    layer: 'steps',
    path: '*/value/intentRoute/intentOp/signedMetadata/(accounting|fees)/sponsorFee/(protocol|relayer|plannedGasPrincipalMicroUsd|plannedFillGasPrincipalMicroUsd|surchargeBaseUsd|surchargeUsd)',
    kind: 'tolerance',
    relative: 0.1,
    presence: true,
    reason:
      'Sponsored gas and its surcharge follow live gas prices; the surcharge rate and subsidies stay exact.',
  },
  {
    id: 'steps.intent-cost.fees',
    layer: 'steps',
    path: '*/value/intentRoute/intentCost/(tokensReceived|feeTokens)/**/(fee|amount|*Fee)',
    kind: 'tolerance',
    relative: 0.1,
    presence: true,
    reason:
      'Token fees follow live gas and token prices; whether a category is charged must match.',
  },
  {
    id: 'steps.intent-cost.usd',
    layer: 'steps',
    path: '*/value/intentRoute/intentCost/(feeBreakdownUSD|gasCost)/**/*USD',
    kind: 'tolerance',
    relative: 0.1,
    absolute: 0.02,
    presence: true,
    reason:
      'USD fees follow live gas and token prices; whether a category is charged must match.',
  },
  {
    id: 'steps.intent-cost.token-price',
    layer: 'steps',
    path: '*/value/intentRoute/intentCost/feeTokens/*/usdPrice',
    kind: 'tolerance',
    relative: AMOUNT_TOLERANCE,
    reason: 'Fee token USD price at quote time.',
  },
  {
    id: 'steps.wait.fill-hash',
    layer: 'steps',
    path: '*/value/fill/hash',
    kind: 'mask',
    label: 'tx-hash',
    reason: 'Each execution lands in its own fill transaction.',
  },
  {
    id: 'steps.wait.claim-hash',
    layer: 'steps',
    path: '*/value/claims/*/hash',
    kind: 'ignore',
    reason:
      'A claim hash appears only once the claim lands; whether polling stopped at FILLED or COMPLETED is relayer timing.',
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
    id: 'cost.outputs',
    layer: 'cost',
    path: '*/outputs/*/amount',
    kind: 'tolerance',
    relative: AMOUNT_TOLERANCE,
    reason:
      'A max-out request receives the balance minus price-derived fees; requested amounts are compared exactly in quoteRequest.',
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
