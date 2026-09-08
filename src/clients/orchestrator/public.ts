// Public orchestrator API types relocated verbatim from the legacy
// `src/orchestrator/types.ts` so the published surface no longer depends on the
// legacy tree. Internal wire representations live in `./types`.

import type { Address, Chain, Hex, TypedDataDefinition } from 'viem'
import type { NonEvmAddress } from '../../chains/non-evm'

// v2: chain ids are open (`number`), not a closed union — a new chain needs no
// SDK release.
type SupportedChain = number

// Cross-chain settlement layers exposed for filtering. v2: defined locally (a
// closed capability union) rather than read from shared-configs — adding a
// layer is a real code change.
type CrossChainSettlementLayer =
  | 'ACROSS'
  | 'ECO'
  | 'RELAY'
  | 'OFT'
  | 'NEAR'
  | 'RHINO'
  | 'CCTP'
  | 'LZ'

type SupportedTokenSymbol = 'ETH' | 'WETH' | 'USDC' | 'USDT' | 'USDT0'
type SupportedToken = SupportedTokenSymbol | Address

type AccountType = 'GENERIC' | 'ERC7579' | 'EOA'

const INTENT_STATUS_PENDING = 'PENDING'
const INTENT_STATUS_FAILED = 'FAILED'
const INTENT_STATUS_COMPLETED = 'COMPLETED'

/**
 * High-level intent status.
 *
 * - `PENDING`   – the intent has been accepted and is being processed
 * - `COMPLETED` – all operations finished successfully
 * - `FAILED`    – the intent failed (inspect `operations` for details)
 */
type IntentStatus =
  | typeof INTENT_STATUS_PENDING
  | typeof INTENT_STATUS_COMPLETED
  | typeof INTENT_STATUS_FAILED

type MappedChainTokenAccessList = {
  chainTokens?: {
    [chainId in SupportedChain]?: SupportedToken[]
  }
  chainTokenAmounts?: {
    [chainId in SupportedChain]?: Partial<Record<SupportedToken, bigint>>
  }
}

type UnmappedChainTokenAccessList = {
  chainIds?: SupportedChain[]
  tokens?: SupportedToken[]
}

type AccountAccessList =
  | MappedChainTokenAccessList
  | UnmappedChainTokenAccessList

/** Per-operation status. */
type OperationStatus = 'PENDING' | 'COMPLETED' | 'FAILED'

/**
 * Why an operation failed. Only meaningful when `status` is `FAILED`.
 *
 * - `EXPIRED`          – the operation deadline passed without completion
 * - `REVERTED`         – the on-chain transaction reverted
 * - `RELAYER_FAILURE`  – the relayer reported failure, or none was available
 * - `DISPATCH_FAILED`  – the orchestrator could not get the action to the
 *                        relayer market at all, so no relayer ever saw it
 * - `BRIDGE_TIMEOUT`   – the bridge neither delivered nor resolved in time
 * - `BRIDGE_REFUNDED`  – the bridge returned the funds instead of delivering;
 *                        pair it with `refunds` on the status for the
 *                        transaction that returned them
 *
 * The orchestrator's own enum additionally has `NONE`, which it filters out
 * before serialising, so it is deliberately not here. Closed rather than
 * widened to `string` for the same reason as the settlement layers above: a
 * new reason is a real code change, and consumers branch on these.
 */
type FailureReason =
  | 'EXPIRED'
  | 'REVERTED'
  | 'RELAYER_FAILURE'
  | 'DISPATCH_FAILED'
  | 'BRIDGE_TIMEOUT'
  | 'BRIDGE_REFUNDED'

/**
 * One operation per chain involved in the intent.
 *
 * The orchestrator returns `items[]` per chain for future extensibility;
 * the SDK flattens to one entry per chain for simpler DX.
 */
type ChainOperation =
  | {
      /** Chain ID this operation belongs to. */
      chain: number
      status: 'PENDING'
    }
  | {
      chain: number
      status: 'COMPLETED'
      /** Transaction hash of the confirmed on-chain transaction. */
      txHash: Hex
      /** UNIX epoch seconds when the on-chain transaction was confirmed. */
      timestamp: number
    }
  | {
      chain: number
      status: 'FAILED'
      /** Why the operation failed. */
      failureReason: FailureReason
    }

interface Execution {
  to: Address
  value: bigint
  data: Hex
}

type SettlementLayer =
  | 'SAME_CHAIN'
  | 'INTENT_EXECUTOR'
  | CrossChainSettlementLayer

type SettlementLayerFilter =
  | { include: CrossChainSettlementLayer[] }
  | { exclude: CrossChainSettlementLayer[] }

// Swap venues the orchestrator can source a route from. Defined locally for the
// same reason as the settlement layers above: a closed capability union, where
// adding a venue is a real code change rather than a config read.
type SwapQuoter =
  | '1inch'
  | '0x'
  | 'velora'
  | 'kyberswap'
  | 'fynd'
  | 'fynd-hosted'
  | 'bebop'
  | 'relay'

// Restricts which venues may serve the intent's swaps. Use it to keep a swap on
// the venue an on-chain smart-session policy is scoped to — the orchestrator
// otherwise picks the venue after the session is signed, and a route through a
// venue the session does not permit is rejected on-chain.
//
// Omit for "any venue the chain supports". An EMPTY allow-list means "no venue"
// and fails closed, exactly as an empty settlement-layer filter does.
type SwapQuoterFilter = { include: SwapQuoter[] } | { exclude: SwapQuoter[] }

// ---------------------------------------------------------------------------
// HyperCore actions
//
// A pass-through of Hyperliquid's own L1 action shapes, spelled out rather than
// typed `unknown`, because the bytes ARE the authorisation: the agent allowed to
// place the order is recovered from a signature over the encoded action, so a
// misspelled or extra field forges an agent that can authorise nothing. The
// orchestrator rejects an unknown key for the same reason.
//
// Single-letter keys are Hyperliquid's, not ours.
// ---------------------------------------------------------------------------

/**
 * Time in force.
 *
 * `Ioc` fills what it can and cancels the rest, which is how a market order is
 * expressed here — Hyperliquid has no market order type. `Alo` is post-only,
 * `Gtc` rests on the book.
 *
 * Prefer `Ioc` for an order whose collateral the intent delivers: a resting
 * order leaves the account holding USDC and no position, and the agent that
 * could have cancelled it authorised the order and nothing else.
 */
type HyperCoreTimeInForce = 'Alo' | 'Ioc' | 'Gtc'

/** A plain limit order. */
interface HyperCoreLimitOrderType {
  limit: { tif: HyperCoreTimeInForce }
}

/** A take-profit or stop-loss order, triggered at `triggerPx`. */
interface HyperCoreTriggerOrderType {
  trigger: {
    isMarket: boolean
    /** Trigger price, as a plain decimal string. */
    triggerPx: string
    /** Take-profit or stop-loss. */
    tpsl: 'tp' | 'sl'
  }
}

type HyperCoreOrderType = HyperCoreLimitOrderType | HyperCoreTriggerOrderType

/** One order, in Hyperliquid's wire shape. */
interface HyperCoreOrder {
  /**
   * Asset index — an index, not a ticker. Perps use the position in the `meta`
   * universe, spot uses `10000 + index` from `spotMeta`; an index resolved
   * against the wrong universe places a valid order in the wrong market.
   */
  a: number
  /** Buy (`true`) or sell (`false`). */
  b: boolean
  /**
   * Limit price, as a plain decimal string. At most 5 significant figures and
   * at most `6 - szDecimals` decimals for a perp; Hyperliquid refuses the rest.
   *
   * The price is fixed when you sign, and an intent that bridges collateral to
   * HyperCore takes ~30s to deliver, so price it to still cross after that
   * move — otherwise the order is refused with the funds already delivered.
   */
  p: string
  /** Size in units of the asset, to at most the asset's `szDecimals`. */
  s: string
  /**
   * Reduce-only. `true` is how a position is closed — pair it with an intent
   * that requests no tokens, since closing needs no delivered collateral.
   */
  r: boolean
  t: HyperCoreOrderType
  /**
   * Optional client order id — 128-bit hex. The exchange echoes it back, so it
   * is the handle that correlates a fill with the intent that placed it.
   */
  c?: Hex
}

/** Place one or more orders. */
interface HyperCoreOrderAction {
  type: 'order'
  orders: HyperCoreOrder[]
  /** `na` for a plain order; the TP/SL groupings bracket a position. */
  grouping: 'na' | 'normalTpsl' | 'positionTpsl'
  /** Builder fee recipient and rate, in tenths of a basis point. */
  builder?: { b: Address; f: number }
}

/** Cancel resting orders by order id. */
interface HyperCoreCancelAction {
  type: 'cancel'
  cancels: { a: number; o: number }[]
  f?: boolean
}

/** Cancel resting orders by client order id. */
interface HyperCoreCancelByCloidAction {
  type: 'cancelByCloid'
  cancels: { asset: number; cloid: Hex }[]
  f?: boolean
}

/** Replace a resting order. */
interface HyperCoreModifyAction {
  type: 'modify'
  oid: number | string
  order: HyperCoreOrder
  /**
   * Place the replacement even if the cancel failed. Omit it for the default —
   * Hyperliquid rejects an action encoded with `a: false`, so there is no false
   * value to pass.
   */
  a?: true
}

/** Replace several resting orders. */
interface HyperCoreBatchModifyAction {
  type: 'batchModify'
  modifies: { oid: number | string; order: HyperCoreOrder }[]
  a?: true
}

/** Switch an asset between cross and isolated margin, and set its leverage. */
interface HyperCoreUpdateLeverageAction {
  type: 'updateLeverage'
  asset: number
  /** Cross margin (`true`) or isolated (`false`). */
  isCross: boolean
  /**
   * New leverage, capped by the asset's own maximum. Set it before the intent
   * that opens the position — applied afterwards it does not resize one.
   */
  leverage: number
}

/** Add or remove isolated margin on an open position. */
interface HyperCoreUpdateIsolatedMarginAction {
  type: 'updateIsolatedMargin'
  asset: number
  isBuy: boolean
  /** Margin to add (positive) or remove (negative), in USDC with 6 decimals. */
  ntli: number
}

/** A Hyperliquid L1 action, passed through as Hyperliquid defines it. */
type HyperCoreAction =
  | HyperCoreOrderAction
  | HyperCoreCancelAction
  | HyperCoreCancelByCloidAction
  | HyperCoreModifyAction
  | HyperCoreBatchModifyAction
  | HyperCoreUpdateLeverageAction
  | HyperCoreUpdateIsolatedMarginAction

const SIG_MODE_EMISSARY = 0
const SIG_MODE_ERC1271 = 1
const SIG_MODE_EMISSARY_ERC1271 = 2
const SIG_MODE_ERC1271_EMISSARY = 3
const SIG_MODE_EMISSARY_EXECUTION = 4
const SIG_MODE_EMISSARY_EXECUTION_ERC1271 = 5
const SIG_MODE_ERC1271_EMISSARY_EXECUTION = 6

type SignatureMode =
  | typeof SIG_MODE_EMISSARY
  | typeof SIG_MODE_ERC1271
  | typeof SIG_MODE_EMISSARY_ERC1271
  | typeof SIG_MODE_ERC1271_EMISSARY
  | typeof SIG_MODE_EMISSARY_EXECUTION
  | typeof SIG_MODE_EMISSARY_EXECUTION_ERC1271
  | typeof SIG_MODE_ERC1271_EMISSARY_EXECUTION

type AuxiliaryFunds = {
  [chainId: number]: Record<Address, bigint>
}

interface IntentOptions {
  appFees?: AppFeeRate
  protocolFees?: ProtocolFeeRate
  /**
   * Absolute unix timestamp (seconds) overriding the on-chain fill deadline.
   * Same-chain (tokenless) route only; ignored elsewhere. Bounds (`now + 120s`
   * .. `now + 86400s`) are enforced by the orchestrator.
   */
  customDeadline?: number
  sponsorSettings?: SponsorSettings
  settlementLayers?: SettlementLayerFilter
  quoters?: SwapQuoterFilter
  signatureMode?: SignatureMode
  auxiliaryFunds?: AuxiliaryFunds
  /**
   * The HyperCore action this intent authorises, already concrete.
   *
   * Committed to when the intent is quoted, not when it executes: the agent
   * that authorises the action is derived from the action's own bytes, and the
   * signature covers a registration carrying that agent's address. Nothing
   * about it can be chosen later — the price included.
   */
  hyperCore?: { action: HyperCoreAction }
}

interface AppFeeRate {
  feeBps: number
}

/**
 * Rate for the Rhinestone protocol fee — a clone of the app fee that always
 * accrues to Rhinestone regardless of the caller's API key, collected alongside
 * the app fee in one batched transfer, and (unlike the app fee) sponsorable via
 * `SponsorSettings.protocolFees`.
 */
interface ProtocolFeeRate {
  feeBps: number
}

/** An integrator's accrued app-fee balance, as USD totals. */
interface AppFeeBalances {
  /** Collected (accrued) app fees available to withdraw, valued in USD at collection. */
  withdrawableUsd: number
  /** Value reserved by an in-flight withdrawal; `0` until withdrawals are enabled. */
  pendingUsd: number
}

interface SponsorSettings {
  gas: boolean
  bridgeFees: boolean
  swapFees: boolean
  protocolFees?: boolean
}

interface PortfolioToken {
  symbol: string
  chains: {
    chain: number
    address: Address
    decimals: number
    amount: bigint
  }[]
}

type Portfolio = PortfolioToken[]

interface IntentInput {
  account: Account
  destinationChainId: number
  destinationExecutions: Execution[]
  destinationGasUnits?: bigint
  tokenRequests: {
    tokenAddress: Address | NonEvmAddress
    amount?: bigint
  }[]
  recipient?: Account
  accountAccessList?: AccountAccessList
  options: IntentOptions
  preClaimExecutions?: Record<number, Execution[]>
}

// Transport projection: `bigint` becomes a decimal string, every other type
// keeps its shape (template-literal `Address`/`Hex`, optionality, index
// signatures). Internal — only the `IntentInput` projection below is published.
type Serialized<T> = T extends bigint
  ? string
  : T extends string | number | boolean | null | undefined
    ? T
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T

/**
 * {@link IntentInput} as it crosses the transport boundary: the same shape, with
 * every `bigint` field serialized to a decimal string.
 *
 * This is the canonical form the SDK exposes as
 * `PreparedTransactionData.intentInput` and passes to a JWT auth
 * `getIntentExtensionToken` callback, and the form a sponsorship JWT's digest
 * commits to. Type a sponsorship endpoint's request body with it instead of
 * re-deriving the mapping locally.
 *
 * Compile-time shape only: an untrusted request body still needs runtime
 * validation.
 */
type SerializedIntentInput = Serialized<IntentInput>

interface UsdAmount {
  usd: number
}

interface FeeCategory extends UsdAmount {
  /**
   * Whether a sponsor absorbs some or all of this category.
   * The user-vs-sponsor split is not surfaced.
   */
  sponsored: boolean
}

type Price = { usd: number } | null

interface CostTokenEntry {
  chainId: number
  tokenAddress: Address
  symbol: string | null
  decimals: number | null
  price: Price
  amount: bigint
}

interface FeeBreakdown {
  gas: FeeCategory
  bridge: FeeCategory
  swap: FeeCategory
  app: FeeCategory
  protocol: FeeCategory
  sponsorSurcharge: FeeCategory
}

interface Fees {
  total: UsdAmount
  breakdown: FeeBreakdown
}

interface Cost {
  input: CostTokenEntry[]
  output: CostTokenEntry[]
  fees: Fees
}

interface EstimatedFillTime {
  seconds: number
}

interface SignData {
  origin: TypedDataDefinition[]
  destination: TypedDataDefinition
  targetExecution?: TypedDataDefinition
}

/**
 * Per-intent tracking handle for settlement layers that hand delivery off to
 * a third-party bridge or solver network.
 */
type BridgeFill =
  | { type: 'OFT'; destinationChainId: number }
  | { type: 'ECO'; destinationChainId: number; intentHash: Hex }
  | { type: 'RELAY'; destinationChainId: number; requestId: string }
  | { type: 'NEAR'; destinationChainId: number; depositAddress: Address }
  | { type: 'RHINO'; destinationChainId: number; commitmentId: string }
  | {
      type: 'CCTP'
      destinationChainId: number
      sourceDomainId: number
      destinationDomainId: number
    }
  | {
      type: 'LZ'
      destinationChainId: number
      quoteId: string
      dstChainKey: string
      routeTypes: string[]
    }

interface Quote {
  intentId: string
  expiresAt: number
  estimatedFillTime: EstimatedFillTime
  settlementLayer: SettlementLayer
  signData: SignData
  cost: Cost
  tokenRequirements?: TokenRequirements
  bridgeFill?: BridgeFill
}

interface QuoteResponse {
  traceId: string
  routes: Quote[]
}

type OriginSignature = Hex | { notarizedClaimSig: Hex; preClaimSig: Hex }

interface SignedAuthorization {
  chainId: string
  address: Address
  nonce: number
  yParity: number
  r: Hex
  s: Hex
}

interface IntentSubmitRequest {
  intentId: string
  signatures: {
    origin: OriginSignature[]
    destination: Hex
    targetExecution?: Hex
  }
  authorizations?: {
    sponsor?: SignedAuthorization[]
    recipient?: SignedAuthorization[]
  }
}

/**
 * Internal augmentation of the submit request. Not part of the blanc public
 * schema, but the orchestrator still reads `options.dryRun` from the raw body.
 * Used by the SDK's `simulate` flag — never surfaced to consumers.
 */
interface IntentSubmitRequestInternal extends IntentSubmitRequest {
  options?: {
    dryRun?: boolean
  }
}

interface IntentSubmitResponse {
  traceId: string
  intentId: string
}

type AccountContext =
  | {
      accountType: 'smartAccount'
      isDeployed: boolean
      isERC7579: boolean
      erc7579AccountType: string
      erc7579AccountVersion: string
    }
  | {
      accountType: 'EOA'
    }

interface Account {
  // EVM accounts use viem's `Address`; non-EVM recipients pass the raw
  // chain-namespace-specific string (Solana base58, Tron T-prefix). The
  // orchestrator validates the format against the destination's CAIP-2
  // namespace.
  address: Address | NonEvmAddress
  /**
   * Account type — required for EVM accounts. Omitted for non-EVM
   * recipients (Solana / Tron) where smart-account semantics don't apply
   * and the orchestrator schema requires it unset.
   */
  accountType?: AccountType
  /**
   * Per-chain account-setup operations — required for EVM accounts.
   * Omitted for non-EVM recipients for the same reason as `accountType`.
   */
  setupOps?: Pick<Execution, 'to' | 'data'>[]
  delegations?: Delegations
  /** Per-chain SSX mock signatures keyed by decimal chainId string. */
  mockSignatures?: Record<`${number}`, Hex>
}

type AccountWithContext = Omit<Account, 'delegations' | 'mockSignatures'> & {
  accountContext: { [chainId: number]: AccountContext }
  requiredDelegations?: Delegations
}

interface Delegation {
  contract: Address
}

type Delegations = Record<number, Delegation>

interface WrapRequired {
  type: 'wrap'
  amount: bigint
}

interface ApprovalRequired {
  type: 'approval'
  amount: bigint
  spender: Address
}

type TokenRequirements = {
  [chainId: number]: {
    [tokenAddress: Address]: ApprovalRequired | WrapRequired
  }
}

interface TokenConfig {
  symbol: string
  address: Address
  decimals: number
}

export type TokenPrices = {
  [key in SupportedTokenSymbol]?: number
}

export type GasPrices = Partial<Record<number, bigint>>

export type OPNetworkParams =
  | Partial<
      Record<
        number,
        {
          l1BaseFee: bigint
          l1BlobBaseFee: bigint
          baseFeeScalar: bigint
          blobFeeScalar: bigint
        }
      >
    >
  | {
      estimatedCalldataSize: number
    }

interface SplitIntentsInput {
  chain: Chain
  tokens: Record<Address, bigint>
  settlementLayers?: SettlementLayerFilter
}

interface SplitIntentsResult {
  traceId: string
  intents: Record<Address, bigint>[]
}

/**
 * A settlement layer returned the intent's funds to the account instead of
 * delivering them.
 *
 * Not an operation: Rhinestone neither built nor broadcast this transaction,
 * and a refund never makes the intent succeed — a refunded intent stays
 * `FAILED`, because it did not do what was asked.
 */
interface IntentRefund {
  /** Chain the refund landed on. */
  chain: number
  /**
   * The refund transaction, in the chain's native form (EVM hex, Solana
   * base58, Tron hex). Interpret it against `chain`.
   */
  txHash: string
}

/**
 * Full intent status as returned by the orchestrator (blanc API version).
 *
 * One operation per chain involved in the intent. The SDK flattens the
 * orchestrator's per-chain `items[]` to a single entry per chain.
 */
interface IntentOpStatus {
  /** OpenTelemetry trace ID for correlating this orchestrator response. */
  traceId: string
  /** High-level intent status. */
  status: IntentStatus
  /** The smart-account address that owns this intent. */
  accountAddress: Address
  /** Per-chain operation status. One entry per chain. */
  operations: ChainOperation[]
  /**
   * Bridge refunds observed for this intent.
   *
   * Undefined means no refund is KNOWN — never that the funds were kept. A
   * refund is recorded only where a settlement layer evidences it with a
   * transaction, so presence is a fact and absence is not a claim. Read it
   * with the operations: a `FAILED` intent whose debiting operation never
   * completed did not take the funds in the first place.
   */
  refunds?: IntentRefund[]
}

export type {
  Account,
  AccountType,
  AccountWithContext,
  AppFeeRate,
  ProtocolFeeRate,
  AuxiliaryFunds,
  AppFeeBalances,
  TokenConfig,
  SupportedChain,
  SettlementLayer,
  SettlementLayerFilter,
  SwapQuoter,
  SwapQuoterFilter,
  HyperCoreAction,
  HyperCoreOrder,
  HyperCoreOrderType,
  HyperCoreTimeInForce,
  HyperCoreOrderAction,
  HyperCoreCancelAction,
  HyperCoreCancelByCloidAction,
  HyperCoreModifyAction,
  HyperCoreBatchModifyAction,
  HyperCoreUpdateLeverageAction,
  HyperCoreUpdateIsolatedMarginAction,
  SignatureMode,
  IntentInput,
  SerializedIntentInput,
  BridgeFill,
  Quote,
  QuoteResponse,
  Cost,
  CostTokenEntry,
  FeeBreakdown,
  Fees,
  Price,
  UsdAmount,
  EstimatedFillTime,
  SignData,
  IntentSubmitRequest,
  IntentSubmitRequestInternal,
  IntentSubmitResponse,
  IntentOpStatus,
  IntentRefund,
  IntentOptions,
  SponsorSettings,
  SignedAuthorization,
  SplitIntentsInput,
  SplitIntentsResult,
  Portfolio,
  PortfolioToken,
  Execution,
  AccountAccessList,
  MappedChainTokenAccessList,
  UnmappedChainTokenAccessList,
  OriginSignature,
  TokenRequirements,
  WrapRequired,
  ApprovalRequired,
  TypedDataDefinition,
  OperationStatus,
  FailureReason,
  ChainOperation,
  IntentStatus,
}
export {
  INTENT_STATUS_PENDING,
  INTENT_STATUS_FAILED,
  INTENT_STATUS_COMPLETED,
  SIG_MODE_EMISSARY,
  SIG_MODE_ERC1271,
  SIG_MODE_EMISSARY_ERC1271,
  SIG_MODE_ERC1271_EMISSARY,
  SIG_MODE_EMISSARY_EXECUTION,
  SIG_MODE_EMISSARY_EXECUTION_ERC1271,
  SIG_MODE_ERC1271_EMISSARY_EXECUTION,
}
