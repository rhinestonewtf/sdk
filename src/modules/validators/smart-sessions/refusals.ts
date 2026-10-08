import type { IntentExecutorSettlementLayer } from './types'

/**
 * Every stable code a `crossChainPermits` refusal carries, with what it means.
 * Codes never change once published; the messages beside them may.
 */
export const CROSS_CHAIN_PERMIT_REFUSAL_CODES = {
  VALID_AFTER_AFTER_VALID_UNTIL: 'validAfter is later than validUntil',
  SESSION_WINDOW_REQUIRES_ONE_TIME_USE:
    'a validAfter, or a validUntil without oneTimeUse',
  VALID_UNTIL_NOT_IN_FUTURE: 'a validUntil that is not a future Date',
  PERMIT2_MAX_AMOUNT_REQUIRES_ONE_TIME_USE:
    'maxAmount on a Permit2-layer permit without oneTimeUse',
  SETTLEMENT_SCOPED_SALT_V1:
    "an IntentExecutor-layer permit with saltMode 'v1'",
  MIXED_PERMIT_KINDS:
    'IntentExecutor-layer and Permit2-layer permits in one session',
  MULTIPLE_INTENT_EXECUTOR_PERMITS:
    'more than one IntentExecutor-layer permit in one session',
  PERMIT2_LAYER_WITH_INTENT_EXECUTOR_LAYER:
    'a Permit2 layer named beside IntentExecutor layers in one permit',
  SAME_CHAIN_WITH_OTHER_LAYERS:
    'SAME_CHAIN_IE named beside another IntentExecutor layer',
  NO_FROM_ON_CHAIN: "no `from` leg on the session's chain",
  MAX_AMOUNT_REQUIRES_ONE_TIME_USE:
    'maxAmount on an IntentExecutor-layer permit without oneTimeUse',
  MULTIPLE_MAX_AMOUNTS: 'maxAmount on more than one `from` token per chain',
  RECIPIENT_ANY_NOT_ALLOWED: "recipient 'any' without allowRecipientNotAccount",
  RECIPIENT_NEEDS_ACCOUNT:
    'the recipient defaults to the account, but the definition has no `account`',
  RECIPIENT_NOT_ACCOUNT:
    'a recipient other than the account without allowRecipientNotAccount',
  MISSING_TO: 'an IntentExecutor-layer permit names no `to` chains',
  FILL_DEADLINE_ONLY_PERMIT2: 'fillDeadline on an IntentExecutor-layer permit',
  MAX_FEE_BPS_ONLY_ECO: 'maxFeeBps without ECO_IE',
  MIN_AMOUNT_ON_PERMIT2_LAYER: '`to.minAmount` on a Permit2-layer permit',
  SAME_CHAIN_TRANSFER_MIN_AMOUNT: '`to.minAmount` on a SAME_CHAIN_IE transfer',
  MIN_AMOUNT_OUTSIDE_CAP:
    '`to.minAmount` outside [maxAmount / 2, maxAmount] of a capped `from` leg',
  MIN_AMOUNT_NOT_ENFORCEABLE:
    '`to.minAmount` on a layer that cannot enforce it (CCTP)',
  MIN_AMOUNT_NOT_POSITIVE: 'a `to.minAmount` of zero',
  MIN_AMOUNT_ABOVE_UINT64: 'an OFT or LZ `to.minAmount` above uint64',
  FLOOR_DECIMALS_MISMATCH:
    'an OFT or LZ floor whose `from` and `to` tokens lack served, equal decimals',
  CONFLICTING_LEG_FLOORS:
    'two `to` legs the layer cannot tell apart with different `to.minAmount`',
  LZ_FLOORED_LEG_NOT_ALONE:
    'a floored LZ leg beside another `to` leg on its chain',
  LZ_FLOOR_ON_CCTP_ROUTE: 'a floored LZ leg on a chain LZ reaches over CCTP',
  SETTLEMENT_CATALOG_MISSING:
    "IntentExecutor layers without the orchestrator's settlement addresses",
  LAYER_REQUIRES_ONE_TIME_USE: 'OFT or LZ without oneTimeUse',
  LAYER_NOT_SERVED: 'the layer does not route on a named chain',
  MAX_FEE_BPS_ECO_UNAVAILABLE:
    "maxFeeBps with settlementLayers 'all' where ECO_IE cannot settle",
  NO_LAYER_CAN_SETTLE:
    "settlementLayers 'all' where no IntentExecutor layer can settle",
  MULTIPLE_FEE_PAYING_LAYERS: 'both OFT and LZ, which each pay a native fee',
  ONE_SOURCE_TOKEN: 'the layer takes exactly one `from` token per chain',
  TOKEN_NOT_ROUTED: 'a `from` or `to` token the layer does not move',
  ECO_STABLECOIN_DECIMALS:
    'an ECO_IE token priced by maxFeeBps that is not one served USD stablecoin of 6 or 18 decimals',
  ACCOUNT_REQUIRED: 'the layer needs `account` on the definition',
  ECO_NEEDS_MAX_AMOUNT_AND_FEE:
    'ECO_IE without maxAmount, or without maxFeeBps where a `to` leg has no `to.minAmount`',
  MAX_FEE_BPS_OUT_OF_RANGE: 'maxFeeBps outside the integers in [0, 10000)',
  ECO_NEEDS_VALID_UNTIL: 'ECO_IE without validUntil',
  ECO_VALIDITY_TOO_SHORT: 'ECO_IE validUntil under 7 days from now',
  ECO_FLOOR_NEEDS_EQUAL_CAPS:
    'an ECO_IE `to.minAmount` without maxFeeBps across `from` legs with different maxAmount',
  RECIPIENT_ANY_UNPINNABLE:
    "recipient 'any' where the layer must pin a concrete recipient",
  ECO_NO_SHARED_PROVER: 'no Eco prover deployed on both chains of a leg',
  LZ_NO_ROUTE: 'no LZ route from the chain to any `to` chain',
  NATIVE_SOURCE_UNSUPPORTED: 'a native `from` token on SAME_CHAIN_IE',
  SAME_CHAIN_OTHER_CHAIN_LEG: 'a SAME_CHAIN_IE `to` leg on another chain',
  SAME_CHAIN_TRANSFER_TO_SELF: 'a SAME_CHAIN_IE transfer to the account itself',
  SAME_CHAIN_ANY_RECIPIENT_NEEDS_MAX_AMOUNT:
    "a SAME_CHAIN_IE transfer to 'any' without maxAmount",
  SAME_CHAIN_TRANSFER_OR_SINGLE_SWAP:
    'SAME_CHAIN_IE `to` legs that are neither a transfer nor one swap',
  SAME_CHAIN_SWAP_NEEDS_MIN_AMOUNT:
    'a SAME_CHAIN_IE swap without a positive `to.minAmount`',
  SAME_CHAIN_SWAP_NEEDS_MAX_AMOUNT: 'a SAME_CHAIN_IE swap without maxAmount',
  ALLOW_FEES_CATALOG_MISSING:
    "allowFees without the orchestrator's settlement addresses",
  FEES_NOT_SERVED: 'allowFees on a chain with no served fee addresses',
  ALLOW_FEES_NON_STABLECOIN:
    'allowFees with a `from` token that is not a served USD stablecoin',
  ALLOW_FEES_ONLY_INTENT_EXECUTOR: 'allowFees on a Permit2-layer permit',
  SCOPE_INVARIANT: 'an internal invariant of the compiled scope failed',
  ALL_LAYERS_NO_PERMIT2_CLAIM:
    "settlementLayers 'all' reached the Permit2 claim path",
  SIGNING_WITH_INTENT_EXECUTOR_PERMIT:
    'an IntentExecutor-layer permit with `signing` enabled',
  RESTRICTED_WITH_PERMIT2_PERMIT:
    'a restricted session holding a Permit2-layer permit or claimPolicies',
  WRAPPED_NATIVE_TOKEN_UNSERVED:
    "the orchestrator's /chains serves no wrapped-native token for the chain",
  SESSION_REFUSED:
    'the session is refused for a reason outside crossChainPermits; see message',
} as const

export type CrossChainPermitRefusalCode =
  keyof typeof CROSS_CHAIN_PERMIT_REFUSAL_CODES

/** One refusal `createSession` would throw for a session definition. */
export interface CrossChainPermitRefusal {
  readonly code: CrossChainPermitRefusalCode
  /** The exact message `createSession` throws. */
  readonly message: string
  /** The `crossChainPermits` entry refused; absent for a session-wide refusal. */
  readonly permitIndex?: number
  readonly layer?: IntentExecutorSettlementLayer
  readonly chainId?: number
  readonly leg?: 'from' | 'to'
}

type RefusalContext = Omit<CrossChainPermitRefusal, 'code' | 'message'>

/** A plain `Error` carrying a refusal code; the class stays `Error`. */
export function refusal(
  code: CrossChainPermitRefusalCode,
  message: string,
  details: RefusalContext = {},
): Error {
  return Object.assign(new Error(message), { code, ...details })
}

/** Receives a refusal in a dry run, with what the caller knows about it. */
export type CollectRefusal = (error: unknown, context?: RefusalContext) => void

/** Throws an independent refusal, or records it so a dry run can go on. */
export type Refuse = (error: unknown, context?: RefusalContext) => void

export function refuser(
  collect?: CollectRefusal,
  context: RefusalContext = {},
): Refuse {
  return (error, extra) => {
    if (collect === undefined) throw error
    collect(error, { ...context, ...extra })
  }
}

/** `run`'s result, or `undefined` once a dry run has recorded its refusal. */
export function recover<T>(refuse: Refuse, run: () => T): T | undefined {
  try {
    return run()
  } catch (error) {
    if (error instanceof RefusalCollectionHalted) throw error
    refuse(error)
    return undefined
  }
}

/** Ends a dry run whose next stage would read data a refusal removed. */
export class RefusalCollectionHalted extends Error {}

/** Every refusal of `run`, in the order resolution reaches them. */
export function collectRefusals(
  run: (collect: CollectRefusal) => void,
): CrossChainPermitRefusal[] {
  const refusals: CrossChainPermitRefusal[] = []
  const seen = new Set<string>()
  // The v1 salt resolves the definition a second time and meets the same refusals.
  const collect: CollectRefusal = (error, context = {}) => {
    const entry = toRefusal(error, context)
    const key = JSON.stringify(entry)
    if (seen.has(key)) return
    seen.add(key)
    refusals.push(entry)
  }
  try {
    run(collect)
  } catch (error) {
    if (!(error instanceof RefusalCollectionHalted)) collect(error)
  }
  return refusals
}

function toRefusal(
  error: unknown,
  context: RefusalContext,
): CrossChainPermitRefusal {
  const fields = (
    typeof error === 'object' && error !== null ? error : {}
  ) as Partial<CrossChainPermitRefusal>
  // What the error was raised with wins over where it was caught.
  const pick = <K extends keyof RefusalContext>(key: K) => {
    const value = fields[key] ?? context[key]
    return value === undefined ? {} : { [key]: value }
  }
  return {
    code:
      fields.code !== undefined &&
      fields.code in CROSS_CHAIN_PERMIT_REFUSAL_CODES
        ? fields.code
        : 'SESSION_REFUSED',
    message: error instanceof Error ? error.message : String(error),
    ...pick('permitIndex'),
    ...pick('layer'),
    ...pick('chainId'),
    ...pick('leg'),
  }
}
