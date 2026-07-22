import type {
  Address,
  Chain,
  HashTypedDataParameters,
  Hex,
  SignableMessage,
  SignedAuthorizationList,
  TypedData,
  TypedDataDefinition,
} from 'viem'
import type { UserOperationReceipt } from 'viem/account-abstraction'
import { parseCaip2, toEvmChainReference } from '../chains/caip2'
import { getChainReference, sharedChainCatalog } from '../chains/catalog'
import type { DestinationChain } from '../chains/non-evm'
import { normalizeTokenAddress } from '../chains/tokens'
import type {
  OriginSignature,
  Portfolio,
  Quote,
  SignData,
} from '../clients/orchestrator/public'
import type {
  OrchestratorAccountAccessList,
  OrchestratorQuote,
} from '../clients/orchestrator/types'
import type {
  CallInput,
  RhinestoneAccountConfig,
  Session,
  SignerSet,
  SourceAssetInput,
  Transaction,
  UserOperationTransaction,
} from '../config/account'
import { createStaticAccountRuntime } from '../config/account-runtime'
import type { AccountConstructionInput } from '../config/input'
import type { LegacyAccountConfig } from '../config/legacy'
import {
  materializeAccountInvocationContext,
  resolveAccountConfig,
} from '../config/resolve'
import type { AccountInvocationContext } from '../config/resolved'
import {
  IndependentSigningNotSupportedError,
  MismatchedOwnerSignaturesError,
  QuoteNotInPreparedTransactionError,
} from '../errors/execution'
import {
  ecdsaSignerId,
  webauthnSignerId,
} from '../modules/validators/signer-id'
import type { SessionDetails } from '../modules/validators/smart-sessions/types'
import type { OwnerSignature, SignAsOwnerOptions } from '../signing/types'
import {
  projectIntentAccount,
  projectIntentRecipient,
} from '../transactions/intents/account'
import {
  projectCompatibleIntentInput,
  projectCompatibleQuote,
} from '../transactions/intents/compatibility'
import { normalizeIntentQuote } from '../transactions/intents/normalize'
import type {
  IntentInput,
  PreparedIntent,
  PreparedTransactionData,
  QuoteSelection,
  SignedIntent,
  SignedTransactionData,
  TransactionResult,
  TransactionStatus,
} from '../transactions/intents/types'
import type {
  PreparedUserOperation,
  PreparedUserOperationData,
  SignedUserOperationData,
  UserOperationResult,
} from '../transactions/user-operations/types'
import type { CoreComposition } from './compose-types'
import { adaptSignerSelection } from './signer-selection'

interface SubmitTransactionOptions {
  authorizations?: SignedAuthorizationList
  /**
   * When `true`, the orchestrator validates the intent without executing it
   * onchain. Internal use only; the `internal_` prefix marks it as not part
   * of the supported public API.
   */
  internal_dryRun?: boolean
}

export interface SignedIntentData {
  originSignatures: OriginSignature[]
  destinationSignature: Hex
  targetExecutionSignature: Hex | undefined
}

type Compat = LegacyAccountConfig<unknown>

/**
 * The account facade. Mirrors the published `RhinestoneAccount` surface, but
 * every method materializes a fresh invocation context from the retained
 * mutable compatibility config and delegates to the SDK-core composition.
 */
export interface RhinestoneAccount {
  /** The resolved account configuration. */
  config: RhinestoneAccountConfig
  /**
   * Deploy the account on a given chain.
   * @param chain Chain to deploy the account on
   * @param params Optional deployment parameters (sponsorship)
   * @returns `true` once the deployment is submitted
   */
  deploy(chain: Chain, params?: { sponsored?: boolean }): Promise<boolean>
  /**
   * Check whether the account is deployed on a given chain.
   * @param chain Chain to check
   * @returns `true` if the account is deployed, `false` otherwise
   */
  isDeployed(chain: Chain): Promise<boolean>
  /**
   * Set up an existing account on a given chain by installing any missing modules.
   * @param chain Chain to set the account up on
   * @returns `true` once setup is submitted
   */
  setup(chain: Chain): Promise<boolean>
  /**
   * Get the account initialization data, used to deploy the account onchain.
   * @returns The factory address and factory data
   */
  getInitData(): { factory: Address; factoryData: Hex }
  /**
   * Prepare and sign the EIP-7702 account initialization data.
   * @returns The init data signature
   */
  signEip7702InitData(): Promise<Hex>
  /**
   * Prepare a transaction for signing.
   * @param transaction Transaction to prepare
   * @returns The prepared transaction data
   * @see {@link signTransaction} to sign the prepared transaction
   * @see {@link submitTransaction} to submit the signed transaction
   */
  prepareTransaction(transaction: Transaction): Promise<PreparedTransactionData>
  /**
   * Get the typed-data messages to sign for a prepared transaction.
   * @param preparedTransaction Prepared transaction data
   * @param options Optional override; pass `{ intentId }` to inspect a specific quote from `preparedTransaction.quotes.all`
   * @returns The origin, destination, and (when required) target-execution typed-data messages
   * @see {@link prepareTransaction} to prepare the transaction data for signing
   */
  getTransactionMessages(
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ): {
    origin: TypedDataDefinition[]
    destination: TypedDataDefinition
    targetExecution?: TypedDataDefinition
  }
  /**
   * Sign a prepared transaction as one configured owner. The returned signature
   * can be serialized and shared with the party coordinating submission.
   * @param preparedTransaction Prepared transaction data
   * @param options Owner account, optional quote, and multi-factor validator ID
   * @returns This owner's signature contribution
   * @see {@link prepareTransaction} to prepare the transaction data for signing
   * @see {@link assembleTransaction} to combine independent owner signatures
   */
  signTransaction(
    preparedTransaction: PreparedTransactionData,
    options: SignAsOwnerOptions,
  ): Promise<OwnerSignature>
  /**
   * Sign a prepared transaction with the transaction's configured signers.
   * @param preparedTransaction Prepared transaction data
   * @param options Optional override; pass `{ intentId }` to sign a specific quote from `preparedTransaction.quotes.all`
   * @returns The signed transaction data
   * @see {@link prepareTransaction} to prepare the transaction data for signing
   * @see {@link submitTransaction} to submit the signed transaction
   */
  signTransaction(
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ): Promise<SignedTransactionData>
  /**
   * Assemble independently collected owner signatures into a signed transaction.
   * Signatures are deduplicated and ordered according to the configured owner set.
   * Account thresholds are read from the local configuration; an explicit
   * transaction signer set determines active MFA IDs and contributing owners.
   * Callers must keep these synchronized with onchain owner and threshold changes.
   * @param preparedTransaction The prepared transaction every owner signed
   * @param signatures Owner signatures returned by `signTransaction` with an `owner` option
   * @returns Signed transaction data ready for submission
   * @see {@link signTransaction} to create each owner signature
   * @see {@link submitTransaction} to submit the result
   */
  assembleTransaction(
    preparedTransaction: PreparedTransactionData,
    signatures: OwnerSignature[],
  ): Promise<SignedTransactionData>
  /**
   * Sign the EIP-7702 authorizations required for a transaction.
   * @param preparedTransaction Prepared transaction data
   * @returns The signed authorization list
   * @see {@link prepareTransaction} to prepare the transaction data for signing
   */
  signAuthorizations(
    preparedTransaction: PreparedTransactionData,
  ): Promise<SignedAuthorizationList>
  /**
   * Sign a message (EIP-191).
   * @param message Message to sign
   * @param chain Chain to sign the message for
   * @param signers Signers to use, or `undefined` for the account default
   * @returns The signature
   * @see {@link signTypedData} to sign EIP-712 typed data
   */
  signMessage(
    message: SignableMessage,
    chain: Chain,
    signers: SignerSet | undefined,
  ): Promise<Hex>
  /**
   * Sign typed data (EIP-712).
   * @param parameters Typed-data parameters
   * @param chain Chain to sign the typed data for
   * @param signers Signers to use, or `undefined` for the account default
   * @returns The signature
   * @see {@link signMessage} to sign an EIP-191 message
   */
  signTypedData<
    typedData extends TypedData | Record<string, unknown> = TypedData,
    primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
  >(
    parameters: HashTypedDataParameters<typedData, primaryType>,
    chain: Chain,
    signers: SignerSet | undefined,
  ): Promise<Hex>
  /**
   * Sign an orchestrator intent operation. Used by headless flows that prepare
   * the intent outside the SDK but still need the SDK-owned smart-session
   * signature packing and target-execution signature routing.
   * @param signData Sign data returned by the orchestrator (origin/destination/targetExecution typed data)
   * @param targetChain Chain where the destination execution runs
   * @param signers Signers to use, or `undefined` for the account default
   * @returns The intent signatures, ready for submission
   * @see {@link signTransaction} for the canonical signing path
   */
  signIntent(
    signData: SignData,
    targetChain: DestinationChain,
    signers?: SignerSet,
  ): Promise<SignedIntentData>
  /**
   * Submit a signed transaction.
   * @param signedTransaction Signed transaction data
   * @param options Optional submission options (e.g. EIP-7702 `authorizations`)
   * @returns The transaction result (an intent ID)
   * @see {@link signTransaction} to sign the transaction data
   * @see {@link signAuthorizations} to sign the required EIP-7702 authorizations
   * @see {@link waitForExecution} to wait for the transaction to execute onchain
   */
  submitTransaction(
    signedTransaction: SignedTransactionData,
    options?: SubmitTransactionOptions,
  ): Promise<TransactionResult>
  /**
   * Prepare a user operation for signing.
   * @param transaction User operation to prepare
   * @returns The prepared user operation data
   * @see {@link signUserOperation} to sign the prepared user operation
   * @see {@link submitUserOperation} to submit the signed user operation
   * @see {@link sendUserOperation} to prepare, sign, and submit in one call
   */
  prepareUserOperation(
    transaction: UserOperationTransaction,
  ): Promise<PreparedUserOperationData>
  /**
   * Sign a prepared user operation.
   * @param preparedUserOperation Prepared user operation data
   * @returns The signed user operation data
   * @see {@link prepareUserOperation} to prepare the user operation data for signing
   * @see {@link submitUserOperation} to submit the signed user operation
   */
  signUserOperation(
    preparedUserOperation: PreparedUserOperationData,
  ): Promise<SignedUserOperationData>
  /**
   * Submit a signed user operation.
   * @param signedUserOperation Signed user operation data
   * @returns The user operation result (a UserOp hash)
   * @see {@link signUserOperation} to sign the user operation data
   * @see {@link waitForExecution} to wait for the user operation to execute onchain
   */
  submitUserOperation(
    signedUserOperation: SignedUserOperationData,
  ): Promise<UserOperationResult>
  /**
   * Prepare, sign, and submit a user operation in a single call.
   * @param transaction User operation to send
   * @returns The user operation result (a UserOp hash)
   * @see {@link waitForExecution} to wait for the user operation to execute onchain
   */
  sendUserOperation(
    transaction: UserOperationTransaction,
  ): Promise<UserOperationResult>
  /**
   * Wait for a submitted transaction or user operation to execute onchain.
   * Polls the orchestrator until the intent reaches a terminal state; on failure
   * an `IntentFailedError` is thrown.
   * @param result The result returned by a submit/send call
   * @returns The per-chain operation status (for intents) or a UserOp receipt
   */
  waitForExecution(result: TransactionResult): Promise<TransactionStatus>
  waitForExecution(result: UserOperationResult): Promise<UserOperationReceipt>
  /**
   * Get the account address.
   * @returns The smart account address
   */
  getAddress(): Address
  /**
   * Get the account portfolio (token balances across chains).
   * @param onTestnets Whether to query testnet balances (default is `false`)
   * @returns The account balances
   */
  getPortfolio(onTestnets?: boolean): Promise<Portfolio>
  /**
   * Resolve the smart-session details for a set of sessions.
   * @param sessions Sessions to resolve
   * @returns The resolved session details
   */
  experimental_getSessionDetails(sessions: Session[]): Promise<SessionDetails>
  /**
   * Check whether a smart session is enabled on the account.
   * @param session Session to check
   * @returns `true` if the session is enabled
   */
  experimental_isSessionEnabled(session: Session): Promise<boolean>
  /**
   * Sign the data required to enable a smart session.
   * @param details Session details to enable
   * @returns The enable-session signature
   */
  experimental_signEnableSession(details: SessionDetails): Promise<Hex>
  /**
   * Get the account owners.
   * @remarks Only returns ECDSA owners; owners managed by other validator types are not included.
   * @param chain Chain to read the owners from
   * @returns The owner addresses and threshold, or `null` if unavailable
   */
  getOwners(chain: Chain): Promise<{
    accounts: Address[]
    threshold: number
  } | null>
  /**
   * Get the account validator modules.
   * @param chain Chain to read the validators from
   * @returns The validator module addresses
   */
  getValidators(chain: Chain): Promise<Address[]>
  /**
   * Get the account executor modules.
   * @param chain Chain to read the executors from
   * @returns The executor module addresses
   */
  getExecutors(chain: Chain): Promise<Address[]>
}

function toPublicQuote(quote: OrchestratorQuote): Quote {
  const compatible = projectCompatibleQuote(quote)
  return {
    intentId: compatible.intentId,
    expiresAt: compatible.expiresAt,
    estimatedFillTime: compatible.estimatedFillTime,
    settlementLayer: compatible.settlementLayer,
    signData: {
      origin: [...compatible.signData.origin],
      destination: compatible.signData.destination,
      ...(compatible.signData.targetExecution
        ? { targetExecution: compatible.signData.targetExecution }
        : {}),
    },
    cost: compatible.cost,
    ...(compatible.tokenRequirements
      ? { tokenRequirements: compatible.tokenRequirements }
      : {}),
    ...(compatible.bridgeFill ? { bridgeFill: compatible.bridgeFill } : {}),
  }
}

function toPreparedTransactionData(
  prepared: PreparedIntent<Compat>,
  transaction: Transaction,
  cache: WeakMap<object, PreparedIntent<Compat>>,
): PreparedTransactionData {
  const data: PreparedTransactionData = {
    quotes: {
      traceId: prepared.traceId,
      best: toPublicQuote(prepared.quote),
      all: prepared.quotes.map(toPublicQuote),
    },
    intentInput: projectCompatibleIntentInput(prepared.request),
    transaction,
  }
  cache.set(data, prepared)
  return data
}

function selectedPublicQuote(
  prepared: PreparedTransactionData,
  intentId?: string,
): Quote {
  if (!intentId) return prepared.quotes.best
  const quote = prepared.quotes.all.find(
    (candidate) => candidate.intentId === intentId,
  )
  if (!quote) {
    throw new QuoteNotInPreparedTransactionError({ context: { intentId } })
  }
  return quote
}

function reconstructInput(
  context: AccountInvocationContext<Compat>,
  prepared: PreparedTransactionData,
  intentId?: string,
): Parameters<
  ReturnType<
    CoreComposition<Compat>['createAccount']
  >['workflows']['reconstructPreparedIntent']
>[1] {
  const selected = selectedPublicQuote(prepared, intentId)
  const quote = normalizeIntentQuote(selected as OrchestratorQuote)
  return {
    traceId: prepared.quotes.traceId,
    quote,
    quotes: prepared.quotes.all.map((candidate) =>
      candidate.intentId === quote.intentId
        ? quote
        : normalizeIntentQuote(candidate as OrchestratorQuote),
    ),
    request: prepared.intentInput as PreparedIntent<Compat>['request'],
    intentInput: adaptTransaction(context, prepared.transaction),
  }
}

function toSignedTransactionData(
  prepared: PreparedTransactionData,
  signed: SignedIntent<Compat>,
  cache: WeakMap<object, SignedIntent<Compat>>,
): SignedTransactionData {
  const data: SignedTransactionData = {
    ...prepared,
    quote: toPublicQuote(signed.prepared.quote),
    originSignatures:
      signed.originSignatures as SignedTransactionData['originSignatures'],
    destinationSignature: signed.destinationSignature,
    targetExecutionSignature: signed.targetSignature,
  }
  cache.set(data, signed)
  return data
}

function referenceChain(): import('../chains/types').EvmChainReference {
  for (const id of sharedChainCatalog.getSupportedChainIds()) {
    try {
      return toEvmChainReference(id)
    } catch {
      // Not an EVM chain; keep looking.
    }
  }
  throw new Error('No EVM chain is available for account initialization')
}

export function createAccountFacade(
  compatibilityConfig: LegacyAccountConfig<unknown>,
  composition: CoreComposition<LegacyAccountConfig<unknown>>,
): RhinestoneAccount {
  // Intent identity caches are facade-scoped. Values crossing account/SDK
  // instances are reconstructed and validated by the receiving account.
  const preparedIntents = new WeakMap<object, PreparedIntent<Compat>>()
  const signedIntents = new WeakMap<object, SignedIntent<Compat>>()
  const context = (
    method: AccountInvocationContext<LegacyAccountConfig<unknown>>['method'],
  ) =>
    materializeAccountInvocationContext(
      composition.config,
      compatibilityConfig,
      method,
    )
  const workflowsFor = (
    ctx: AccountInvocationContext<LegacyAccountConfig<unknown>>,
  ) => composition.createAccount(ctx).workflows

  const resolvePrepared = (
    ctx: AccountInvocationContext<Compat>,
    prepared: PreparedTransactionData,
    intentId?: string,
  ): Promise<PreparedIntent<Compat>> => {
    const cached = preparedIntents.get(prepared)
    if (cached && !intentId) return Promise.resolve(cached)
    return workflowsFor(ctx).reconstructPreparedIntent(
      ctx,
      reconstructInput(ctx, prepared, intentId),
    )
  }

  const account: RhinestoneAccount = {
    config: compatibilityConfig as unknown as RhinestoneAccountConfig,
    deploy(chain, params) {
      const ctx = context('deploy')
      return workflowsFor(ctx).deploy(ctx, toEvmChainReference(chain.id), {
        ...(params?.sponsored !== undefined
          ? { sponsored: params.sponsored }
          : {}),
      })
    },
    isDeployed(chain) {
      const ctx = context('is-deployed')
      return workflowsFor(ctx).isDeployed(ctx, toEvmChainReference(chain.id))
    },
    setup(chain) {
      const ctx = context('setup')
      return workflowsFor(ctx).setup(ctx, toEvmChainReference(chain.id))
    },
    getInitData() {
      const ctx = context('get-init-data')
      return workflowsFor(ctx).getInitData(ctx)
    },
    async signEip7702InitData() {
      const ctx = context('sign-eip7702-init-data')
      const result = await workflowsFor(ctx).signEip7702InitData(ctx)
      return result.signature
    },
    async prepareTransaction(transaction) {
      const ctx = context('prepare-intent')
      const prepared = await workflowsFor(ctx).prepareIntent(
        ctx,
        adaptTransaction(ctx, transaction),
      )
      return toPreparedTransactionData(prepared, transaction, preparedIntents)
    },
    getTransactionMessages(preparedTransaction, options) {
      const quote = selectedPublicQuote(preparedTransaction, options?.intentId)
      return {
        origin: [...quote.signData.origin],
        destination: quote.signData.destination,
        ...(quote.signData.targetExecution
          ? { targetExecution: quote.signData.targetExecution }
          : {}),
      }
    },
    signTransaction: ((
      preparedTransaction: PreparedTransactionData,
      options?: QuoteSelection | SignAsOwnerOptions,
    ): Promise<SignedTransactionData | OwnerSignature> => {
      const ctx = context('sign-intent')
      const workflows = workflowsFor(ctx)
      if (options && 'owner' in options) {
        // Independent owner signing is unsupported for smart-session intents;
        // reject before resolving sessions (which would issue an RPC read),
        // matching the legacy fast-fail.
        if (
          preparedTransaction.transaction.signers?.type ===
          'experimental_session'
        ) {
          return Promise.reject(new IndependentSigningNotSupportedError())
        }
        const signerId = signerIdForOwner(options.owner)
        return resolvePrepared(ctx, preparedTransaction, options.intentId).then(
          (internal) =>
            workflows.signIntentAsOwner(ctx, internal, {
              signerId,
              ...(options.validatorId === undefined
                ? {}
                : { validatorId: options.validatorId }),
            }) as unknown as Promise<OwnerSignature>,
        )
      }
      return resolvePrepared(ctx, preparedTransaction, options?.intentId)
        .then((internal) => workflows.signIntent(ctx, internal))
        .then(({ intent }) =>
          toSignedTransactionData(preparedTransaction, intent, signedIntents),
        )
    }) as unknown as RhinestoneAccount['signTransaction'],
    async assembleTransaction(preparedTransaction, signatures) {
      const ctx = context('assemble-intent')
      const workflows = workflowsFor(ctx)
      const intentIds = [...new Set(signatures.map(({ intentId }) => intentId))]
      if (intentIds.length > 1) {
        throw new MismatchedOwnerSignaturesError({ context: { intentIds } })
      }
      const internal = await resolvePrepared(
        ctx,
        preparedTransaction,
        intentIds[0],
      )
      const signed = await workflows.assembleIntent(
        ctx,
        internal,
        signatures as unknown as Parameters<typeof workflows.assembleIntent>[2],
      )
      return toSignedTransactionData(preparedTransaction, signed, signedIntents)
    },
    async signAuthorizations(preparedTransaction) {
      const ctx = context('sign-authorizations')
      const intentInput = adaptTransaction(ctx, preparedTransaction.transaction)
      const chains = authorizationChains(intentInput)
      const result = await workflowsFor(ctx).signAuthorizations(ctx, {
        chains,
        ...(intentInput.eip7702InitSignature
          ? { eip7702InitSignature: intentInput.eip7702InitSignature }
          : {}),
      })
      return result.authorizations as SignedAuthorizationList
    },
    async signMessage(message, chain, signers) {
      const ctx = context('sign-message')
      const result = await workflowsFor(ctx).signMessage(ctx, {
        message,
        chain: toEvmChainReference(chain.id),
        ...(signers
          ? { signers: adaptSignerSelection(ctx.account, signers) }
          : {}),
      })
      return result.signature
    },
    async signTypedData(parameters, chain, signers) {
      const ctx = context('sign-typed-data')
      const result = await workflowsFor(ctx).signTypedData(ctx, {
        typedData: parameters as unknown as TypedDataDefinition,
        chain: toEvmChainReference(chain.id),
        ...(signers
          ? { signers: adaptSignerSelection(ctx.account, signers) }
          : {}),
      })
      return result.signature
    },
    async signIntent(signData, targetChain, signers) {
      const ctx = context('sign-intent')
      const result = await workflowsFor(ctx).signIntentFromSignData(ctx, {
        signData: {
          origin: signData.origin,
          destination: signData.destination,
          ...(signData.targetExecution
            ? { targetExecution: signData.targetExecution }
            : {}),
        },
        targetChain: destinationChainReference(targetChain),
        ...(signers
          ? { signers: adaptSignerSelection(ctx.account, signers) }
          : {}),
      })
      return {
        originSignatures:
          result.originSignatures as SignedIntentData['originSignatures'],
        destinationSignature: result.destinationSignature,
        targetExecutionSignature: result.targetExecutionSignature,
      }
    },
    async submitTransaction(signedTransaction, options) {
      const ctx = context('submit-intent')
      const workflows = workflowsFor(ctx)
      // Fast path for the same-instance signed object; otherwise (cross-instance
      // replay or caller-tampered signatures) rebuild from the public shape.
      const cached = signedIntents.get(signedTransaction)
      const base: SignedIntent<Compat> = cached ?? {
        prepared: await resolvePrepared(ctx, signedTransaction),
        originSignatures:
          signedTransaction.originSignatures as SignedIntent<Compat>['originSignatures'],
        destinationSignature: signedTransaction.destinationSignature,
        ...(signedTransaction.targetExecutionSignature
          ? { targetSignature: signedTransaction.targetExecutionSignature }
          : {}),
        transcript: { planKind: 'intent-full', payloadId: '0x', stages: [] },
      }
      const signed: SignedIntent<Compat> = {
        ...base,
        ...(options?.authorizations
          ? { authorizations: options.authorizations }
          : {}),
        ...(options?.internal_dryRun ? { dryRun: true } : {}),
      }
      const submitted = await workflows.submitIntent(ctx, signed)
      return {
        type: 'intent',
        id: submitted.intentId,
        traceId: submitted.traceId,
        ...(submitted.sourceChains
          ? { sourceChains: [...submitted.sourceChains] }
          : {}),
        targetChain: submitted.targetChain,
      }
    },
    async prepareUserOperation(transaction) {
      assertUserOperationSignerSelection(transaction)
      const ctx = context('prepare-user-operation')
      const prepared = await workflowsFor(ctx).prepareUserOperation(ctx, {
        chain: toEvmChainReference(transaction.chain.id),
        calls: transaction.calls.map((call) =>
          adaptCall(call, transaction.chain.id),
        ),
        ...(transaction.gasLimit === undefined
          ? {}
          : { gasLimit: transaction.gasLimit }),
      })
      const data: PreparedUserOperationData = {
        userOperation:
          prepared.operation as unknown as PreparedUserOperationData['userOperation'],
        hash: prepared.hash,
        transaction,
      }
      return data
    },
    async signUserOperation(preparedUserOperation) {
      const ctx = context('sign-user-operation')
      // Recompute from the current public operation and live owners.
      const internal = await workflowsFor(ctx).reconstructPreparedUserOperation(
        ctx,
        {
          chain: toEvmChainReference(
            preparedUserOperation.transaction.chain.id,
          ),
          operation:
            preparedUserOperation.userOperation as unknown as PreparedUserOperation<Compat>['operation'],
        },
      )
      const signed = await workflowsFor(ctx).signUserOperation(ctx, internal)
      const data: SignedUserOperationData = {
        ...preparedUserOperation,
        signature: signed.signature,
      }
      return data
    },
    async submitUserOperation(signedUserOperation) {
      const ctx = context('submit-user-operation')
      // The public operation and top-level signature remain authoritative.
      const internal = await workflowsFor(ctx).reconstructSignedUserOperation(
        ctx,
        {
          chain: toEvmChainReference(signedUserOperation.transaction.chain.id),
          operation:
            signedUserOperation.userOperation as unknown as PreparedUserOperation<Compat>['operation'],
          signature: signedUserOperation.signature,
        },
      )
      const submitted = await workflowsFor(ctx).submitUserOperation(
        ctx,
        internal,
      )
      return { type: 'userop', hash: submitted.hash, chain: submitted.chain.id }
    },
    async sendUserOperation(transaction) {
      assertUserOperationSignerSelection(transaction)
      const ctx = context('send-user-operation')
      const submitted = await workflowsFor(ctx).sendUserOperation(ctx, {
        chain: toEvmChainReference(transaction.chain.id),
        calls: transaction.calls.map((call) =>
          adaptCall(call, transaction.chain.id),
        ),
        ...(transaction.gasLimit === undefined
          ? {}
          : { gasLimit: transaction.gasLimit }),
      })
      return { type: 'userop', hash: submitted.hash, chain: submitted.chain.id }
    },
    waitForExecution: ((
      result: TransactionResult | UserOperationResult,
    ): Promise<TransactionStatus | UserOperationReceipt> => {
      if (result.type === 'intent') {
        const ctx = context('wait-for-execution')
        return workflowsFor(ctx)
          .waitForIntentStatus(ctx, result.id)
          .then((status) => ({
            traceId: status.traceId,
            status: status.status as TransactionStatus['status'],
            accountAddress: status.account,
            operations: status.operations as TransactionStatus['operations'],
          }))
      }
      const ctx = context('wait-for-execution')
      return workflowsFor(ctx)
        .waitForUserOperationStatus(ctx, {
          type: 'userop',
          chain: toEvmChainReference(result.chain),
          hash: result.hash,
        })
        .then((status) => status.receipt as UserOperationReceipt)
    }) as unknown as RhinestoneAccount['waitForExecution'],
    getAddress() {
      const ctx = context('get-address')
      return workflowsFor(ctx).getAddress(ctx, referenceChain())
    },
    getPortfolio(onTestnets = false) {
      const ctx = context('get-portfolio')
      return workflowsFor(ctx)
        .getPortfolio(ctx, onTestnets)
        .then((portfolio) => portfolio.tokens as unknown as Portfolio)
    },
    experimental_getSessionDetails(sessions) {
      const ctx = context('get-session-details')
      return workflowsFor(ctx).getSessionDetails(ctx, sessions)
    },
    experimental_isSessionEnabled(session) {
      const ctx = context('is-session-enabled')
      return workflowsFor(ctx).isSessionEnabled(ctx, session)
    },
    experimental_signEnableSession(details) {
      const ctx = context('sign-enable-session')
      return workflowsFor(ctx).signEnableSession(ctx, details)
    },
    getOwners(chain) {
      const ctx = context('get-owners')
      return workflowsFor(ctx)
        .getOwners(ctx, toEvmChainReference(chain.id))
        .then((owners) =>
          owners
            ? { accounts: [...owners.accounts], threshold: owners.threshold }
            : null,
        )
    },
    getValidators(chain) {
      const ctx = context('get-validators')
      return workflowsFor(ctx)
        .getValidators(ctx, toEvmChainReference(chain.id))
        .then((addresses) => [...addresses])
    },
    getExecutors(chain) {
      const ctx = context('get-executors')
      return workflowsFor(ctx)
        .getExecutors(ctx, toEvmChainReference(chain.id))
        .then((addresses) => [...addresses])
    },
  }
  return account
}

function signerIdForOwner(owner: SignAsOwnerOptions['owner']): string {
  // ECDSA local accounts also expose `publicKey`, so discriminate on the
  // account type rather than the presence of a public key.
  if ((owner as { type?: string }).type === 'webAuthn') {
    return webauthnSignerId((owner as { publicKey: Hex }).publicKey)
  }
  return ecdsaSignerId((owner as { address: Address }).address)
}

function assertUserOperationSignerSelection(
  transaction: UserOperationTransaction,
): void {
  if (transaction.signers?.type === 'experimental_session') {
    throw new Error('No account found')
  }
}

function destinationChainReference(
  targetChain: DestinationChain,
): import('../chains/types').ChainReference {
  if ('kind' in targetChain && typeof targetChain.caip2 === 'string') {
    return parseCaip2(targetChain.caip2)
  }
  return getChainReference(
    sharedChainCatalog,
    (targetChain as { id: number }).id,
  )
}

// Public `Transaction` -> internal `IntentInput`. Owned here because the facade
// is the only translation point between the compatibility surface and the
// intent workflow.
export function adaptTransaction(
  context: AccountInvocationContext<Compat>,
  transaction: Transaction,
): IntentInput {
  const destination =
    'chain' in transaction
      ? getChainReference(sharedChainCatalog, transaction.chain.id)
      : 'kind' in transaction.targetChain
        ? parseCaip2(transaction.targetChain.caip2)
        : getChainReference(sharedChainCatalog, transaction.targetChain.id)
  const destinationChainId =
    destination.kind === 'evm' ? destination.id : undefined
  const sourceChains =
    'chain' in transaction
      ? [getChainReference(sharedChainCatalog, transaction.chain.id)]
      : transaction.sourceChains?.map((chain) =>
          getChainReference(sharedChainCatalog, chain.id),
        )
  const evmSources = sourceChains?.flatMap((chain) =>
    chain.kind === 'evm' ? [chain] : [],
  )
  return {
    destination,
    ...(evmSources ? { sourceChains: evmSources } : {}),
    calls: (transaction.calls ?? []).map((call) =>
      adaptCall(call, destinationChainId),
    ),
    tokenRequests: (transaction.tokenRequests ?? []).map((request) => ({
      token:
        destinationChainId === undefined
          ? request.address
          : normalizeTokenAddress(
              sharedChainCatalog,
              request.address,
              destinationChainId,
              false,
            ),
      ...(request.amount === undefined ? {} : { amount: request.amount }),
    })),
    ...(transaction.recipient
      ? {
          recipient: adaptRecipient(
            context,
            transaction.recipient,
            destination,
            transaction.eip7702InitSignature,
            transaction.experimental_accountOverride?.setupOps,
          ),
        }
      : {}),
    ...(transaction.gasLimit === undefined
      ? {}
      : { gasLimit: transaction.gasLimit }),
    ...(transaction.eip7702InitSignature
      ? { eip7702InitSignature: transaction.eip7702InitSignature }
      : {}),
    ...(transaction.sourceAssets || sourceChains
      ? {
          accountAccessList: adaptSourceAssets(
            transaction.sourceAssets,
            evmSources?.map(({ id }) => id),
          ),
        }
      : {}),
    options: {
      ...(transaction.appFees ? { appFees: transaction.appFees } : {}),
      ...('chain' in transaction && transaction.customDeadline !== undefined
        ? { customDeadline: transaction.customDeadline }
        : {}),
      ...(transaction.sponsored
        ? {
            sponsorSettings:
              typeof transaction.sponsored === 'boolean'
                ? {
                    gas: transaction.sponsored,
                    bridgeFees: transaction.sponsored,
                    swapFees: transaction.sponsored,
                  }
                : {
                    gas: transaction.sponsored.gas,
                    bridgeFees: transaction.sponsored.bridging,
                    swapFees: transaction.sponsored.swaps,
                  },
          }
        : {}),
      ...(transaction.settlementLayers
        ? { settlementLayers: transaction.settlementLayers }
        : {}),
      ...(transaction.auxiliaryFunds
        ? { auxiliaryFunds: transaction.auxiliaryFunds }
        : {}),
    },
    ...(transaction.sourceCalls
      ? {
          sourceCalls: Object.fromEntries(
            Object.entries(transaction.sourceCalls).map(([chainId, calls]) => [
              Number(chainId),
              calls.map((call) => ({
                call: adaptCall(call, Number(chainId)),
                ...(call.provides ? { provides: call.provides } : {}),
              })),
            ]),
          ),
        }
      : {}),
    ...(transaction.experimental_accountOverride?.setupOps
      ? {
          accountSetupOverride:
            transaction.experimental_accountOverride.setupOps,
        }
      : {}),
    ...(transaction.signers
      ? {
          signers:
            transaction.signers.type === 'experimental_session'
              ? {
                  kind: 'smart-session',
                  byChain: adaptSessionSelection(
                    transaction,
                    sourceChains ?? [],
                  ),
                }
              : adaptSignerSelection(context.account, transaction.signers),
        }
      : {}),
  }
}

function adaptRecipient(
  context: AccountInvocationContext<Compat>,
  recipient: RhinestoneAccountConfig | string,
  destination: IntentInput['destination'],
  eip7702InitSignature: Hex | undefined,
  setupOverride:
    | readonly { readonly to: Address; readonly data: Hex }[]
    | undefined,
): NonNullable<IntentInput['recipient']> {
  if (typeof recipient === 'string') {
    return projectIntentRecipient(recipient, destination)
  }
  if (destination.kind !== 'evm') {
    throw new Error('Smart-account recipients require an EVM destination')
  }
  const resolved = resolveAccountConfig(
    context.sdk,
    toAccountConstructionInput(recipient),
  )
  return projectIntentAccount({
    runtime: createStaticAccountRuntime(resolved, destination, false),
    ...(setupOverride ? { setupOverride } : {}),
    ...(eip7702InitSignature ? { eip7702InitSignature } : {}),
  })
}

function toAccountConstructionInput(
  config: RhinestoneAccountConfig,
): AccountConstructionInput {
  return {
    ...(config.account ? { account: config.account } : {}),
    ...(config.owners ? { owners: config.owners } : {}),
    ...(config.experimental_sessions
      ? { experimental_sessions: config.experimental_sessions }
      : {}),
    ...(config.eoa ? { eoa: config.eoa } : {}),
    ...(config.modules ? { modules: config.modules } : {}),
    ...(config.initData ? { initData: config.initData } : {}),
  }
}

export function authorizationChains(
  input: IntentInput,
): readonly IntentInput['destination'][] {
  const chains = [...(input.sourceChains ?? []), input.destination]
  const seen = new Set<string>()
  return chains.filter((chain) => {
    if (seen.has(chain.caip2)) return false
    seen.add(chain.caip2)
    return true
  })
}

function adaptCall(call: CallInput, chainId: number | undefined) {
  if ('resolve' in call) {
    return {
      resolve: async (ctx: {
        config: unknown
        chain: { id: number }
        account: Address
      }) => {
        const chain = sharedChainCatalog.getChain(ctx.chain.id)
        if (!chain) throw new Error(`Unsupported chain ${ctx.chain.id}`)
        const value = await call.resolve({
          config: ctx.config as never,
          chain,
          accountAddress: ctx.account,
        })
        return (Array.isArray(value) ? value : [value]).map((item) =>
          normalizeCall(item, ctx.chain.id),
        )
      },
    }
  }
  if (chainId === undefined) {
    throw new Error('Destination calls are not supported for non-EVM chains')
  }
  return normalizeCall(call, chainId)
}

function normalizeCall(
  call: Exclude<CallInput, { resolve: unknown }>,
  chainId: number,
) {
  return {
    target: normalizeTokenAddress(
      sharedChainCatalog,
      call.to,
      chainId,
      false,
    ) as Address,
    value: call.value ?? 0n,
    data: call.data ?? '0x',
  }
}

function adaptSessionSelection(
  transaction: Transaction,
  chains: readonly { readonly kind: string; readonly id?: number }[],
) {
  const signers = transaction.signers
  if (!signers || signers.type !== 'experimental_session') return {}
  if ('sessions' in signers) {
    return Object.fromEntries(
      Object.entries(signers.sessions).map(([chainId, selection]) => [
        Number(chainId),
        selection,
      ]),
    )
  }
  const chainIds = new Set(
    chains.flatMap((chain) =>
      chain.kind === 'evm' && chain.id !== undefined ? [chain.id] : [],
    ),
  )
  if ('chain' in transaction) chainIds.add(transaction.chain.id)
  if ('targetChain' in transaction && 'id' in transaction.targetChain) {
    chainIds.add(transaction.targetChain.id)
  }
  return Object.fromEntries(
    [...chainIds].map((chainId) => [
      chainId,
      {
        session: signers.session,
        ...(signers.enableData ? { enableData: signers.enableData } : {}),
      },
    ]),
  )
}

function adaptSourceAssets(
  sourceAssets: SourceAssetInput | undefined,
  chainIds: readonly number[] | undefined,
): OrchestratorAccountAccessList | undefined {
  if (!sourceAssets) return chainIds ? { chainIds } : undefined
  if (Array.isArray(sourceAssets)) {
    if (sourceAssets.length > 0 && typeof sourceAssets[0] === 'object') {
      const chainTokens: Record<number, Address[]> = {}
      const chainTokenAmounts: Record<number, Record<Address, bigint>> = {}
      for (const item of sourceAssets as {
        chain: { id: number }
        address: Address | string
        amount?: bigint
      }[]) {
        const token = normalizeTokenAddress(
          sharedChainCatalog,
          item.address,
          item.chain.id,
          false,
        ) as Address
        if (item.amount === undefined)
          (chainTokens[item.chain.id] ??= []).push(token)
        else (chainTokenAmounts[item.chain.id] ??= {})[token] = item.amount
      }
      return {
        ...(Object.keys(chainTokens).length > 0 ? { chainTokens } : {}),
        ...(Object.keys(chainTokenAmounts).length > 0
          ? { chainTokenAmounts }
          : {}),
      }
    }
    return {
      ...(chainIds ? { chainIds } : {}),
      tokens: sourceAssets as string[],
    }
  }
  return { chainTokens: sourceAssets }
}
