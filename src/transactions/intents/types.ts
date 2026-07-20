import type { Address, Hex, SignedAuthorization } from 'viem'
import type { AccountRuntimePort } from '../../accounts/adapter'
import type { UnresolvedCall } from '../../calls/types'
import type { ChainReference, EvmChainReference } from '../../chains/types'
import type {
  IntentQuotePort,
  IntentStatusPort,
  IntentSubmissionPort,
} from '../../clients/orchestrator/port'
import type {
  IntentOpStatus,
  OriginSignature,
  Quote,
} from '../../clients/orchestrator/public'
import type {
  OrchestratorAccountAccessList,
  OrchestratorIntentOptions,
  OrchestratorIntentRequest,
  OrchestratorOriginSignature,
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
  SignerInvocationPort,
  SigningCheckpointPort,
  SigningTranscript,
} from '../../signing/types'

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
  readonly recipient?: Address | string
  readonly gasLimit?: bigint
  readonly eip7702InitSignature?: Hex
  readonly accountAccessList?: OrchestratorAccountAccessList
  readonly options?: Omit<OrchestratorIntentOptions, 'signatureMode'>
  readonly signatureMode?: number
  readonly sourceCalls?: Readonly<
    Record<number, readonly IntentSourceCall<CompatibilityConfig>[]>
  >
  readonly accountSetupOverride?: readonly {
    readonly to: Address
    readonly data: Hex
  }[]
  readonly signers?: IntentSessionSelection
}

export interface PreparedIntent<CompatibilityConfig = unknown> {
  readonly traceId: string
  readonly input: IntentInput<CompatibilityConfig>
  readonly request: OrchestratorIntentRequest
  readonly quote: OrchestratorQuote
  readonly quotes: readonly OrchestratorQuote[]
  readonly signing: IntentSigningInput
  readonly accountChain: EvmChainReference
  readonly resolvedSessions?: Readonly<Record<number, ResolvedSessionSignerSet>>
  readonly sessionEnvironment?: 'production' | 'development'
}

export interface SignedIntent<CompatibilityConfig = unknown> {
  readonly prepared: PreparedIntent<CompatibilityConfig>
  readonly originSignatures: readonly OrchestratorOriginSignature[]
  readonly destinationSignature: Hex
  readonly targetSignature?: Hex
  readonly transcript: SigningTranscript
  readonly authorizations?: readonly SignedAuthorization[]
  readonly dryRun?: boolean
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
  readonly status: string
  readonly account: Address
  readonly operations: readonly unknown[]
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

export interface PreparedTransactionData {
  quotes: PreparedQuotes
  intentInput: unknown
  transaction: Transaction
}

export interface QuoteSelection {
  intentId: string
}

export interface SignedTransactionData extends PreparedTransactionData {
  quote: Quote
  originSignatures: OriginSignature[]
  destinationSignature: Hex
  targetExecutionSignature: Hex | undefined
}

export interface TransactionStatus {
  /** OpenTelemetry trace ID for correlating the status response. */
  traceId: IntentOpStatus['traceId']
  /** High-level intent status. */
  status: IntentOpStatus['status']
  /** The account address that owns this intent. */
  accountAddress: Address
  /** Per-chain operation status. One entry per chain. */
  operations: IntentOpStatus['operations']
}
