import type {
  DroppedSettlementLayer,
  SessionAccess,
  SettlementCoverage,
} from './types'

/**
 * Every stable code a `crossChainPermits` refusal carries, with what it means.
 * Codes never change once published; the messages beside them may.
 */
export const SESSION_REFUSAL_CODES = {
  VALID_AFTER_EXCEEDS_VALID_UNTIL: 'validAfter is later than validUntil',
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
  SAME_CHAIN_IE_WITH_OTHER_LAYERS:
    'SAME_CHAIN_IE named beside another IntentExecutor layer',
  NO_FROM_ON_CHAIN: "no `from` leg on the session's chain",
  INTENT_EXECUTOR_MAX_AMOUNT_REQUIRES_ONE_TIME_USE:
    'maxAmount on an IntentExecutor-layer permit without oneTimeUse',
  MULTIPLE_MAX_AMOUNTS: 'maxAmount on more than one `from` token per chain',
  RECIPIENT_ANY_NOT_ALLOWED: "recipient 'any' without allowRecipientNotAccount",
  RECIPIENT_NEEDS_ACCOUNT:
    'the recipient defaults to the account, but the definition has no `account`',
  RECIPIENT_NOT_ACCOUNT:
    'a recipient other than the account without allowRecipientNotAccount',
  MISSING_TO: 'an IntentExecutor-layer permit names no `to` chains',
  FILL_DEADLINE_ONLY_PERMIT2: 'fillDeadline on an IntentExecutor-layer permit',
  MAX_FEE_BPS_ONLY_ECO_IE: 'maxFeeBps without ECO_IE',
  MIN_AMOUNT_ON_PERMIT2_LAYER: '`to.minAmount` on a Permit2-layer permit',
  SAME_CHAIN_IE_TRANSFER_MIN_AMOUNT:
    '`to.minAmount` on a SAME_CHAIN_IE transfer',
  MIN_AMOUNT_OUTSIDE_CAP:
    '`to.minAmount` outside [maxAmount / 2, maxAmount] of a capped `from` leg',
  MIN_AMOUNT_NOT_ENFORCEABLE:
    '`to.minAmount` on a layer that cannot enforce it (CCTP)',
  MIN_AMOUNT_NOT_POSITIVE: 'a `to.minAmount` of zero or less',
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
  LAYER_REQUIRES_ONE_TIME_USE:
    'a layer that pays a native fee (OFT, LZ) without oneTimeUse',
  LAYER_NOT_SERVED: 'the layer does not route on a named chain',
  MAX_FEE_BPS_ECO_IE_UNAVAILABLE:
    "maxFeeBps with settlementLayers 'all' where ECO_IE cannot settle",
  NO_LAYER_CAN_SETTLE:
    "settlementLayers 'all' where no IntentExecutor layer can settle",
  MULTIPLE_FEE_PAYING_LAYERS: 'both OFT and LZ, which each pay a native fee',
  ONE_SOURCE_TOKEN: 'the layer takes exactly one `from` token per chain',
  TOKEN_NOT_ROUTED: 'a `from` or `to` token the layer does not move',
  ECO_IE_STABLECOIN_DECIMALS:
    'an ECO_IE token priced by maxFeeBps that is not one served USD stablecoin of 6 or 18 decimals',
  ACCOUNT_REQUIRED: 'the layer needs `account` on the definition',
  ECO_IE_NEEDS_MAX_AMOUNT_AND_FEE:
    'ECO_IE without maxAmount, or without maxFeeBps where a `to` leg has no `to.minAmount`',
  MAX_FEE_BPS_OUT_OF_RANGE: 'maxFeeBps outside the integers in [0, 10000)',
  ECO_IE_VALIDITY_TOO_SHORT: 'ECO_IE validUntil under 7 days from now',
  ECO_IE_FLOOR_NEEDS_EQUAL_CAPS:
    'an ECO_IE `to.minAmount` without maxFeeBps across `from` legs with different maxAmount',
  RECIPIENT_ANY_UNPINNABLE:
    "recipient 'any' where the layer must pin a concrete recipient",
  ECO_IE_NO_SHARED_PROVER: 'no Eco prover deployed on both chains of a leg',
  LZ_NO_ROUTE: 'no LZ route from the chain to any `to` chain',
  NATIVE_SOURCE_UNSUPPORTED: 'a native `from` on SAME_CHAIN_IE or Permit2',
  SAME_CHAIN_IE_OTHER_CHAIN_LEG: 'a SAME_CHAIN_IE `to` leg on another chain',
  SAME_CHAIN_IE_TRANSFER_TO_SELF:
    'a SAME_CHAIN_IE transfer to the account itself',
  SAME_CHAIN_IE_ANY_RECIPIENT_NEEDS_MAX_AMOUNT:
    "a SAME_CHAIN_IE transfer to 'any' without maxAmount",
  SAME_CHAIN_IE_TRANSFER_OR_SINGLE_SWAP:
    'SAME_CHAIN_IE `to` legs that are neither a transfer nor one swap',
  SAME_CHAIN_IE_SWAP_NEEDS_MIN_AMOUNT:
    'a SAME_CHAIN_IE swap without a positive `to.minAmount`',
  SAME_CHAIN_IE_SWAP_NEEDS_MAX_AMOUNT: 'a SAME_CHAIN_IE swap without maxAmount',
  ALLOW_FEES_CATALOG_MISSING:
    "allowFees without the orchestrator's settlement addresses",
  FEES_NOT_SERVED: 'allowFees on a chain with no served fee addresses',
  ALLOW_FEES_NON_STABLECOIN:
    'allowFees with a `from` token that is not a served USD stablecoin with known decimals',
  ALLOW_FEES_MIXED_DECIMALS:
    'allowFees with `from` tokens of different decimals on one chain',
  ALLOW_FEES_ONLY_INTENT_EXECUTOR: 'retired: allowFees applies to Permit2 too',
  SIGNING_WITH_INTENT_EXECUTOR_PERMIT:
    'an IntentExecutor-layer permit with `signing` enabled',
  RESTRICTED_WITH_PERMIT2_GRANTS: 'a restricted session holding claimPolicies',
  PERMIT2_ROUTE_NEEDS_FROM:
    "a Permit2-layer permit with no `from` on the session's chain, without `fallback` or with allowFees",
  RETIRED_PERMIT2_LAYER: 'a permit naming the Permit2 ECO arbiter',
  PERMIT2_APPROVE_CONFLICT: 'a declared approve on a Permit2 `from` token',
  FALLBACK_NOT_APPLICABLE:
    '`fallback` without a Permit2-layer permit, or with restrictToActions or swap',
  PERMIT2_ROUTE_NEEDS_BOUND:
    "a Permit2-layer permit without oneTimeUse, preClaimOps: 'none' or `fallback`, on a chain without Permit2SenderPolicy",
  PERMIT2_ROUTE_ACROSS_ONLY:
    'a Permit2-layer permit naming a layer other than ACROSS, without `fallback`',
  PRE_CLAIM_OPS_NOT_APPLICABLE:
    "preClaimOps: 'none' with oneTimeUse or allowFees, or on an IntentExecutor-layer permit",
  NATIVE_DESTINATION_UNSUPPORTED:
    'a native `to` token on a Permit2-layer permit, without `fallback`',
  WRAPPED_NATIVE_ZERO_CAP: 'a wrapped native `from` leg with maxAmount 0',
  WRAPPED_NATIVE_TOKEN_UNSERVED:
    "the orchestrator's /chains serves no wrapped-native token for the chain",
  CLAIM_POLICIES_SIGNING_MODE:
    "a scoped or disabled `signing` mode beside claim policies, including a Permit2-layer permit's",
  CLAIM_POLICIES_SIGNING_WINDOW_CLOSED:
    'a `signing.validUntil` that is not in the future beside claim policies',
  DUPLICATE_ERC1271_POLICY:
    'one ERC-1271 policy installed twice, e.g. by two Permit2-layer permits',
  UNIVERSAL_ACTION_COPY_INVALID:
    'a universalActionCopies entry that is another policy or repeats',
  UNIVERSAL_ACTION_POLICY_NO_CODE:
    'universalAction has no code on the chain, so its copies cannot be checked',
  UNIVERSAL_ACTION_COPY_CODE_MISMATCH:
    'a universalActionCopies entry without the code of universalAction',
  SESSION_REFUSED:
    'the session is refused for a reason with no code of its own; see message',
} as const

export type SessionRefusalCode = keyof typeof SESSION_REFUSAL_CODES

/** Every stable code a session warning carries, with what it means. */
export const SESSION_WARNING_CODES = {
  FALLBACK_RECIPIENT_PIN_ACROSS_ONLY:
    'a recipient pin on a `fallback` session, which holds only for intents settled by ACROSS',
} as const

export type SessionWarningCode = keyof typeof SESSION_WARNING_CODES

/** Something `createSession` accepts but that does not hold as the definition may suggest. */
export interface SessionWarning {
  readonly code: SessionWarningCode
  readonly message: string
  /** The `crossChainPermits` entry it is about. */
  readonly permitIndex?: number
}

/** One refusal `createSession` would throw for a session definition. */
export interface SessionRefusal {
  readonly code: SessionRefusalCode
  /** The exact message `createSession` throws. */
  readonly message: string
  /** The `crossChainPermits` entry refused; absent for a session-wide refusal. */
  readonly permitIndex?: number
  /** The settlement layer that refused, when one layer did. */
  readonly layer?: DroppedSettlementLayer['layer']
  /** The chain the refusal is about, when it is about one. */
  readonly chainId?: number
  /** Which side of the permit the refused token or recipient is on. */
  readonly leg?: 'from' | 'to'
}

/** What a dry run of `createSession` reports for a session definition. */
export interface SessionValidation {
  /** Every refusal, the first being the one `createSession` throws; empty exactly when it succeeds. */
  readonly refusals: readonly SessionRefusal[]
  /** The created session's `access`; present only when nothing is refused. */
  readonly access?: SessionAccess
  /** The created session's `settlementCoverage`; present only when nothing is refused and a permit is settlement-scoped. */
  readonly settlementCoverage?: SettlementCoverage
  /** What the session accepts but does not enforce as it may read; present only when there is one. */
  readonly warnings?: readonly SessionWarning[]
}

type RefusalContext = Omit<SessionRefusal, 'code' | 'message'>

/** A plain `Error` carrying a refusal code; the class stays `Error`. */
export function refusal(
  code: SessionRefusalCode,
  message: string,
  details: RefusalContext = {},
): Error {
  return Object.assign(new Error(message), { code, ...details })
}

/** Throws an independent refusal, or records it so a dry run can go on. */
export type Refuse = (error: unknown, context?: RefusalContext) => void

/** A refuser that throws, or that records into `collect` with `context` added. */
export function refuser(
  collect?: Refuse,
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

/** Whether `error` carries one of the published refusal codes. */
export function isCodedRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && Object.hasOwn(SESSION_REFUSAL_CODES, code)
}

/** A dry run's record: each refusal once, in the order they are met. */
export function refusalLog(): {
  readonly refusals: SessionRefusal[]
  readonly collect: Refuse
} {
  const refusals: SessionRefusal[] = []
  const seen = new Set<string>()
  // The v1 salt resolves the definition a second time and meets the same refusals.
  const collect: Refuse = (error, context = {}) => {
    const entry = toRefusal(error, context)
    const key = JSON.stringify(entry)
    if (seen.has(key)) return
    seen.add(key)
    refusals.push(entry)
  }
  return { refusals, collect }
}

/** `run`'s result and every refusal it meets; no result once one is met. */
export function collectRefusals<T>(
  run: (collect: Refuse) => T,
  log = refusalLog(),
): { readonly refusals: SessionRefusal[]; readonly result?: T } {
  try {
    const result = run(log.collect)
    return log.refusals.length
      ? { refusals: log.refusals }
      : { refusals: log.refusals, result }
  } catch (error) {
    if (!(error instanceof RefusalCollectionHalted)) log.collect(error)
    return { refusals: log.refusals }
  }
}

function toRefusal(error: unknown, context: RefusalContext): SessionRefusal {
  const fields = (
    typeof error === 'object' && error !== null ? error : {}
  ) as Partial<SessionRefusal>
  // What the error was raised with wins over where it was caught.
  const pick = <K extends keyof RefusalContext>(key: K) => {
    const value = fields[key] ?? context[key]
    return value === undefined ? {} : { [key]: value }
  }
  return {
    code:
      isCodedRefusal(error) && fields.code !== undefined
        ? fields.code
        : 'SESSION_REFUSED',
    message: error instanceof Error ? error.message : String(error),
    ...pick('permitIndex'),
    ...pick('layer'),
    ...pick('chainId'),
    ...pick('leg'),
  }
}
