import {
  type BatchPermit2Result,
  type IntentOp,
  type IntentRoute,
  type MultiChainPermit2Config,
  type MultiChainPermit2Result,
  type PreparedTransactionData,
  type Quote,
  type QuoteCost,
  type SignedIntentOp,
  type SignedTransactionData,
  signPermit2Batch,
  signPermit2Sequential,
  type Transaction,
} from '@rhinestone/sdk'
import {
  getCompactDigest,
  getCompactTypedData,
  getPermit2Digest,
} from '@rhinestone/sdk/dist/src/execution/compact'
import { getTypedData as getPermit2TypedData } from '@rhinestone/sdk/dist/src/execution/permit2'
import { getTypedData as getSingleChainTypedData } from '@rhinestone/sdk/dist/src/execution/singleChainOps'
import type { Orchestrator } from '@rhinestone/sdk/dist/src/orchestrator'
import type {
  ElementSwapDestination,
  ElementSwapOrigin,
  ExecutionWithPlaceholders,
  FeeBreakdown,
  FeeBreakdownUSD,
  FeesByTokenEntry,
  IntentCost,
  IntentInput,
  IntentOpElement,
  IntentOpElementMandate,
  IntentResult,
  Op,
} from '@rhinestone/sdk/dist/src/orchestrator/types'
import {
  computeBlancIntentInputDigest,
  computeIntentInputDigest,
  createAccessTokenHandler,
  createExpressRouter,
  createExtensionTokenHandler,
  createJwtSigner,
  type JwtHandlerConfig,
} from '@rhinestone/sdk/jwt-server'
import type { Address, Hex } from 'viem'

declare const prepared: PreparedTransactionData
declare const signed: SignedTransactionData
declare const route: IntentRoute
const quote: Quote = prepared.quote
const cost: QuoteCost = signed.quote.cost
const requirements: IntentRoute['tokenRequirements'] = quote.tokenRequirements
// @ts-expect-error Prepared transactions no longer contain Alps routes.
prepared.intentRoute
// @ts-expect-error Signed transactions no longer contain Alps routes.
signed.intentRoute
// @ts-expect-error An Alps route cannot be used as a Blanc quote.
const invalidQuote: Quote = route
// @ts-expect-error Neither can an Alps route replace the prepared quote.
const invalidPrepared: PreparedTransactionData = { ...prepared, quote: route }

// Retained legacy types and callable signatures must remain usable.
export type Legacy = [
  IntentOp,
  SignedIntentOp,
  IntentOpElement,
  IntentOpElementMandate,
  IntentCost,
  IntentResult,
  FeeBreakdown,
  FeeBreakdownUSD,
  FeesByTokenEntry,
  Op,
  ExecutionWithPlaceholders,
  ElementSwapDestination,
  ElementSwapOrigin,
  MultiChainPermit2Config,
  MultiChainPermit2Result,
  BatchPermit2Result,
]
declare const orchestrator: Orchestrator
declare const intentInput: IntentInput
declare const signedOp: SignedIntentOp
declare const intentOp: IntentOp
declare const element: IntentOpElement
declare const configs: MultiChainPermit2Config[]
declare const address: Address
const legacyRoute: Promise<IntentRoute> =
  orchestrator.getIntentRoute(intentInput)
const legacySubmit: Promise<IntentResult> = orchestrator.submitIntent(
  signedOp,
  false,
  {
    intentInput,
    isSponsored: true,
  },
)
const quotes: Promise<Quote[]> = orchestrator.createQuote(intentInput)
const intent: Promise<{ intentId: string }> = orchestrator.createIntent({
  intentId: 'id',
  signatures: { origin: [], destination: '0x' },
})
const compact: {
  primaryType: 'MultichainCompact'
  message: { sponsor: Address; nonce: bigint; expires: bigint }
} = getCompactTypedData(intentOp)
const compactDigest: Hex = getCompactDigest(intentOp)
const permitDigest: Hex = getPermit2Digest(element, 1n, 2n)
const permit: {
  primaryType: 'PermitBatchWitnessTransferFrom'
  message: { spender: Address; nonce: bigint; deadline: bigint }
} = getPermit2TypedData(element, 1n, 2n)
const single: {
  primaryType: 'SingleChainOps'
  message: { account: Address; nonce: bigint; op: Op }
} = getSingleChainTypedData(address, address, element, 1n)
const batch: Promise<BatchPermit2Result> = signPermit2Batch(configs)
const sequential: Promise<BatchPermit2Result> = signPermit2Sequential(
  configs,
  (completed: number, total: number, current: MultiChainPermit2Result) => {
    void [completed, total, current]
  },
)
void [
  legacyRoute,
  legacySubmit,
  quotes,
  intent,
  compact,
  compactDigest,
  permitDigest,
  permit,
  single,
  batch,
  sequential,
]
declare const transaction: Transaction
transaction.feeAsset
transaction.lockFunds

declare const config: JwtHandlerConfig
const blancConfig = { ...config, apiVersion: 'blanc' as const }
createJwtSigner(blancConfig)
createAccessTokenHandler(blancConfig)
createExtensionTokenHandler(blancConfig)
createExpressRouter(blancConfig)
declare const input: Parameters<typeof computeBlancIntentInputDigest>[0]
computeBlancIntentInputDigest(input)
computeIntentInputDigest(input)
void [cost, requirements, invalidQuote, invalidPrepared]
