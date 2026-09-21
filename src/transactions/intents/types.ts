import type { Address, Hex, SignedAuthorization } from 'viem'
import type { AccountRuntimePort } from '../../accounts/adapter'
import type { UnresolvedCall } from '../../calls/types'
import type { SolanaAddress } from '../../chains/non-evm'
import type { ChainReference, EvmChainReference } from '../../chains/types'
import type {
  NormalizedIntentInput,
  NormalizedIntentOptions,
} from '../../clients/orchestrator/normalized'
import type {
  IntentQuotePort,
  IntentStatusPort,
  IntentSubmissionPort,
} from '../../clients/orchestrator/port'
import type {
  IntentOpStatus,
  Quote,
  SerializedIntentInput,
  SigningProof,
} from '../../clients/orchestrator/public'
import type {
  OrchestratorIntentRequest,
  OrchestratorQuote,
} from '../../clients/orchestrator/types'
import type { Transaction } from '../../config/account'
import type {
  ResolvedSessionSignerSet,
  Session,
  SessionEnableData,
} from '../../modules/validators/smart-sessions/types'
import type { IntentSigningInput } from '../../signing/intent-plans/types'
import type {
  OwnerSignerSelection,
  SignerInvocationPort,
  SigningCheckpointPort,
  SigningTranscript,
} from '../../signing/types'
import type { IntentRecipientProjection } from './account'
import type { PreparedIntentBinding } from './compatibility'
import type { IntentSourcePolicy } from './source'

export interface IntentTokenRequest {
  readonly token: Address | string
  readonly amount?: bigint
}

export interface IntentSourceCall<CompatibilityConfig> {
  readonly call: UnresolvedCall<CompatibilityConfig>
  readonly provides?: readonly {
    readonly token: Address
    readonly amount: bigint
  }[]
}

export interface IntentSessionSelection {
  readonly kind: 'smart-session'
  readonly byChain: Readonly<
    Record<
      number,
      {
        readonly session: Session
        readonly enableData?: SessionEnableData
      }
    >
  >
}

export interface IntentInput<CompatibilityConfig = unknown> {
  readonly destination: ChainReference
  readonly sourceChains?: readonly EvmChainReference[]
  readonly calls: readonly UnresolvedCall<CompatibilityConfig>[]
  readonly tokenRequests: readonly IntentTokenRequest[]
  readonly recipient?: IntentRecipientProjection
  readonly gasLimit?: bigint
  readonly eip7702InitSignature?: Hex
  readonly accountAccessList?: IntentSourcePolicy
  readonly options?: Omit<NormalizedIntentOptions, 'signatureMode'>
  readonly signatureMode?: number
  readonly sourceCalls?: Readonly<
    Record<number, readonly IntentSourceCall<CompatibilityConfig>[]>
  >
  readonly accountSetupOverride?: readonly {
    readonly to: Address
    readonly data: Hex
  }[]
  readonly signers?: OwnerSignerSelection | IntentSessionSelection
}

export interface PreparedIntent<CompatibilityConfig = unknown> {
  readonly traceId: string
  readonly input: IntentInput<CompatibilityConfig>
  /** The Caucasus request this quote answers. */
  readonly request: OrchestratorIntentRequest
  /** The normalized sponsorship projection of the same transaction. */
  readonly normalized: NormalizedIntentInput
  readonly quote: OrchestratorQuote
  readonly quotes: readonly OrchestratorQuote[]
  readonly signing: IntentSigningInput
  readonly accountChain: EvmChainReference
  readonly resolvedSessions?: Readonly<Record<number, ResolvedSessionSignerSet>>
  readonly sessionEnvironment?: 'production' | 'development'
}

export interface SignedIntent<CompatibilityConfig = unknown> {
  readonly prepared: PreparedIntent<CompatibilityConfig>
  /** One proof per signing request, in the quoted order. */
  readonly proofs: readonly SigningProof[]
  readonly transcript: SigningTranscript
  readonly dryRun?: boolean
}

/**
 * One externally produced proof, bound to the quote and the request slot it
 * answers.
 *
 * The fingerprint covers the whole ordered request set, so a contribution
 * collected against a different quote — or a re-quote of the same intent —
 * cannot be assembled into this one.
 */
export interface IndexedProofContribution {
  readonly intentId: string
  readonly requestSetId: Hex
  readonly requestIndex: number
  readonly proof: SigningProof
}

export interface SubmittedIntent {
  readonly type: 'intent'
  readonly traceId: string
  readonly intentId: string
  readonly sourceChains?: readonly number[]
  readonly targetChain: number
}

export interface IntentStatus {
  readonly traceId: string
  readonly intentId: string
  readonly purpose: IntentOpStatus['purpose']
  readonly status: IntentOpStatus['status']
  readonly accounts?: IntentOpStatus['accounts']
  readonly operations: readonly IntentOpStatus['operations'][number][]
  /** Bridge refunds, if any are known. See {@link IntentOpStatus.refunds}. */
  readonly refunds?: IntentOpStatus['refunds']
  /** Present only when the status was read with `{ full: true }`. */
  readonly details?: IntentOpStatus['details']
  readonly terminal: boolean
}

export interface IntentWorkflowContext<CompatibilityConfig = unknown> {
  readonly compatibilityConfig: CompatibilityConfig
  readonly account: AccountRuntimePort
  readonly quoteClient: IntentQuotePort
  readonly submissionClient: IntentSubmissionPort
  readonly statusClient: IntentStatusPort
  readonly signerInvoker: SignerInvocationPort
  readonly checkpoints: SigningCheckpointPort
  readonly signAuthorizations: (input: {
    readonly chains: readonly ChainReference[]
    readonly eip7702InitSignature: Hex
  }) => Promise<readonly SignedAuthorization[]>
  readonly signDelegation: (input: {
    readonly chainId: number
    readonly contract: Address
  }) => Promise<SignedAuthorization>
  readonly clock: {
    readonly now: () => number
    readonly sleep: (milliseconds: number) => Promise<void>
  }
}

// Public transaction result types relocated verbatim from the legacy
// `src/execution/utils.ts` / `src/execution/index.ts`.
export interface TransactionResult {
  type: 'intent'
  id: string
  traceId: string
  sourceChains?: number[]
  targetChain: number
}

export interface PreparedQuotes {
  traceId: string
  best: Quote
  all: Quote[]
}

/** Binds a prepared same-chain Solana transfer to the account that prepared it. */
export interface SolanaExecutionMetadata {
  kind: 'solana'
  namespace: 'dev-v1'
  endpoint: string
  chain: number
  caip2: string
  accountAddress: Address
  accountType: 'GENERIC' | 'ERC7579' | 'EOA'
  /** The owner's address for an ECDSA owner; its compressed P-256 key for a passkey. */
  authority: Address | Hex
  swigAddress: SolanaAddress
  walletAddress: SolanaAddress
  recipient: SolanaAddress
  mint: SolanaAddress
}

/**
 * Binds a prepared Solana-origin cross-chain delivery to the account that
 * prepared it, including the EVM chain, token and recipient it delivers to.
 */
export interface SolanaCrossChainExecutionMetadata {
  kind: 'solana-cross-chain'
  namespace: 'dev-v1'
  endpoint: string
  chain: number
  caip2: string
  accountAddress: Address
  accountType: 'GENERIC' | 'ERC7579' | 'EOA'
  /** The owner's address for an ECDSA owner; its compressed P-256 key for a passkey. */
  authority: Address | Hex
  swigAddress: SolanaAddress
  walletAddress: SolanaAddress
  mint: SolanaAddress
  destinationChain: number
  destinationToken: Address
  recipient: Address
}

/**
 * Binds a prepared same-chain Solana instruction execution to the account that
 * prepared it. The instructions themselves are covered by the canonical
 * serialized intent input, not repeated here.
 */
export interface SolanaInstructionsExecutionMetadata {
  kind: 'solana-instructions'
  namespace: 'dev-v1'
  endpoint: string
  chain: number
  caip2: string
  accountAddress: Address
  accountType: 'GENERIC' | 'ERC7579' | 'EOA'
  /** The owner's address for an ECDSA owner; its compressed P-256 key for a passkey. */
  authority: Address | Hex
  swigAddress: SolanaAddress
  walletAddress: SolanaAddress
}

export interface PreparedTransactionData {
  quotes: PreparedQuotes
  /**
   * Present for a managed Solana origin and used to validate persisted data.
   * Narrow on `kind` to read the direction-specific fields.
   */
  execution?:
    | SolanaExecutionMetadata
    | SolanaCrossChainExecutionMetadata
    | SolanaInstructionsExecutionMetadata
  /** Canonical serialized intent input; the shape a sponsorship digest covers. */
  // Deliberately narrowed from the `unknown` this field used to carry. Prepared
  // data produced by `prepareTransaction` and passed straight back to
  // `signTransaction` / `submitTransaction` is unaffected; a value typed against
  // an earlier release — a mocked or persisted prepared object — needs an
  // annotation.
  intentInput: SerializedIntentInput
  /**
   * The Caucasus request this quote answers, versioned so a payload prepared
   * under an earlier wire generation fails before signing rather than being
   * reconstructed from the lossy `intentInput` projection.
   */
  request: PreparedIntentBinding
  transaction: Transaction
}

export interface QuoteSelection {
  intentId: string
}

export interface SignedTransactionData extends PreparedTransactionData {
  quote: Quote
  /** One proof per `quote.signingRequests` entry, in that order. */
  proofs: SigningProof[]
}

export interface IntentStatusOptions {
  /**
   * Ask the orchestrator for the recorded detail block. Off by default, so
   * polling stays lean.
   */
  readonly full?: boolean
}

export interface TransactionStatus {
  /** OpenTelemetry trace ID for correlating the status response. */
  traceId: IntentOpStatus['traceId']
  /** What the intent is for. */
  purpose: IntentOpStatus['purpose']
  /** High-level intent status. */
  status: IntentOpStatus['status']
  /**
   * The accounts the intent used, per VM and chain. Absent where the record
   * does not identify them.
   */
  accounts?: IntentOpStatus['accounts']
  /** Every operation, grouped by the chain it ran on. */
  operations: IntentOpStatus['operations']
  /**
   * Bridge refunds, if any are known. This is where a failed cross-chain
   * transaction says the funds came back. See {@link IntentOpStatus.refunds}.
   */
  refunds?: IntentOpStatus['refunds']
  /** Present only when requested with `{ full: true }`. */
  details?: IntentOpStatus['details']
}
