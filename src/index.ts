import type {
  Abi,
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
import {
  checkAddress,
  deploy as deployInternal,
  FactoryArgsNotAvailableError,
  getAccountProvider,
  getAddress as getAddressInternal,
  getInitCode,
  isDeployed as isDeployedInternal,
  OwnersFieldRequiredError,
  setup as setupInternal,
  signEip7702InitData as signEip7702InitDataInternal,
} from './accounts'
import { type AuthProvider, createAuthProvider } from './auth/provider'
import {
  getAppFeeBalances as getAppFeeBalancesInternal,
  getIntentStatus as getIntentStatusInternal,
  getPortfolio as getPortfolioInternal,
  sendUserOperation as sendUserOperationInternal,
  splitIntents as splitIntentsInternal,
  type TransactionResult,
  type TransactionStatus,
  type UserOperationResult,
  waitForExecution as waitForExecutionInternal,
} from './execution'
import {
  assembleTransaction as assembleTransactionInternal,
  getTargetExecutionSignature as getTargetExecutionSignatureInternal,
  getTransactionMessages as getTransactionMessagesInternal,
  type OwnerPasskeySignature,
  type OwnerSignature,
  type OwnerSignatureData,
  type PreparedQuotes,
  type PreparedTransactionData,
  type PreparedUserOperationData,
  prepareTransaction as prepareTransactionInternal,
  prepareUserOperation as prepareUserOperationInternal,
  type QuoteSelection,
  type SignAsOwnerOptions,
  type SignedTransactionData,
  type SignedUserOperationData,
  signAuthorizations as signAuthorizationsInternal,
  signIntent as signIntentInternal,
  signMessage as signMessageInternal,
  signTransaction as signTransactionInternal,
  signTypedData as signTypedDataInternal,
  signUserOperation as signUserOperationInternal,
  submitTransaction as submitTransactionInternal,
  submitUserOperation as submitUserOperationInternal,
} from './execution/utils'
import {
  getExecutors as getExecutorsInternal,
  getOwners as getOwnersInternal,
  getSessionDetails as getSessionDetailsInternal,
  getValidators as getValidatorsInternal,
  MULTI_FACTOR_VALIDATOR_ADDRESS,
  OWNABLE_VALIDATOR_ADDRESS,
  SMART_SESSION_EMISSARY_ADDRESS,
  signEnableSession as signEnableSessionInternal,
  WEBAUTHN_VALIDATOR_ADDRESS,
} from './modules'
import {
  isSessionEnabled as isSessionEnabledInternal,
  type SessionDetails,
  toSession,
} from './modules/validators/smart-sessions'
import type {
  AppFeeBalances,
  ApprovalRequired,
  AuxiliaryFunds,
  BridgeFill,
  ChainOperation,
  DestinationChain,
  FailureReason,
  IntentInput,
  IntentOpStatus,
  NonEvmAddress,
  NonEvmChain,
  OperationStatus,
  OriginSignature,
  Portfolio,
  Quote,
  SettlementLayer,
  SettlementLayerFilter,
  SignData,
  SplitIntentsInput,
  SplitIntentsResult,
  TokenRequirements,
  WrapRequired,
} from './orchestrator'
import { getOrchestrator } from './orchestrator'

export type { AppFeeBalances, AppFeeRate } from './orchestrator'

import { hyperCoreMainnet, solanaMainnet, tronMainnet } from './orchestrator'
import type {
  AccountProviderConfig,
  AccountType,
  BundlerConfig,
  Call,
  CallInput,
  ChainSessionConfig,
  CrossChainPermissionInput,
  CrossChainPermit,
  CrossChainSettlementLayer,
  FromLeg,
  MultiFactorValidatorConfig,
  NonEvmTokenRequest,
  NonEvmTokenRequests,
  OwnableValidatorConfig,
  OwnerSet,
  ParamConstraint,
  PaymasterConfig,
  Permission,
  PermissionFunctionConfig,
  Permit2ClaimPolicy,
  Policy,
  ProviderConfig,
  RhinestoneAccountConfig,
  RhinestoneConfig,
  RhinestoneSDKConfig,
  Session,
  SessionDefinition,
  SignerSet,
  SourceCallInput,
  SourceCallProvidedFunds,
  TokenRequest,
  TokenSymbol,
  ToLeg,
  Transaction,
  UniversalActionPolicyParamCondition,
  UserOperationTransaction,
  WebauthnValidatorConfig,
} from './types'

interface SubmitTransactionOptions {
  authorizations?: SignedAuthorizationList
  /**
   * When `true`, the orchestrator validates the intent without executing it
   * onchain. Internal use only; the `internal_` prefix marks it as not part
   * of the supported public API.
   */
  internal_dryRun?: boolean
}

interface RhinestoneAccount {
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
  getInitData(): {
    factory: Address
    factoryData: Hex
  }
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

interface SignedIntentData {
  originSignatures: OriginSignature[]
  destinationSignature: Hex
  targetExecutionSignature: Hex | undefined
}

/**
 * Initialize a Rhinestone account from a fully-resolved config.
 * Note: accounts are deployed onchain only when the first transaction is sent.
 * @internal Use {@link RhinestoneSDK.createAccount} instead.
 */
async function createAccountInternal(
  config: RhinestoneConfig,
): Promise<RhinestoneAccount> {
  // Sanity check for existing (externally created) accounts
  // Ensures we decode the initdata correctly
  checkAddress(config)

  // Validate that owners field is provided for non-EOA accounts
  if (config.account?.type !== 'eoa' && !config.owners) {
    throw new OwnersFieldRequiredError()
  }

  /**
   * Deploys the account on a given chain
   * @param chain Chain to deploy the account on
   * @param params Optional deployment params (e.g. `sponsored`)
   */
  function deploy(chain: Chain, params?: { sponsored?: boolean }) {
    return deployInternal(config, chain, params)
  }

  function isDeployed(chain: Chain) {
    return isDeployedInternal(config, chain)
  }

  function setup(chain: Chain) {
    return setupInternal(config, chain)
  }

  function getInitData(): {
    factory: Address
    factoryData: Hex
  } {
    const initData = getInitCode(config)
    if (!initData) {
      throw new FactoryArgsNotAvailableError()
    }
    if (!('factory' in initData)) {
      throw new FactoryArgsNotAvailableError()
    }
    return {
      factory: initData.factory,
      factoryData: initData.factoryData,
    }
  }

  function signEip7702InitData() {
    return signEip7702InitDataInternal(config)
  }

  function prepareTransaction(transaction: Transaction) {
    return prepareTransactionInternal(config, transaction)
  }

  function getTransactionMessages(
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ) {
    return getTransactionMessagesInternal(config, preparedTransaction, options)
  }

  function signTransaction(
    preparedTransaction: PreparedTransactionData,
    options: SignAsOwnerOptions,
  ): Promise<OwnerSignature>
  function signTransaction(
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ): Promise<SignedTransactionData>
  function signTransaction(
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection | SignAsOwnerOptions,
  ): Promise<SignedTransactionData | OwnerSignature> {
    if (options && 'owner' in options) {
      return signTransactionInternal(config, preparedTransaction, options)
    }
    return signTransactionInternal(config, preparedTransaction, options)
  }

  function assembleTransaction(
    preparedTransaction: PreparedTransactionData,
    signatures: OwnerSignature[],
  ) {
    return assembleTransactionInternal(config, preparedTransaction, signatures)
  }

  function signAuthorizations(preparedTransaction: PreparedTransactionData) {
    return signAuthorizationsInternal(config, preparedTransaction)
  }

  function signMessage(
    message: SignableMessage,
    chain: Chain,
    signers: SignerSet | undefined,
  ) {
    return signMessageInternal(config, message, chain, signers)
  }

  function signTypedData<
    typedData extends TypedData | Record<string, unknown> = TypedData,
    primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
  >(
    parameters: HashTypedDataParameters<typedData, primaryType>,
    chain: Chain,
    signers: SignerSet | undefined,
  ) {
    return signTypedDataInternal<typedData, primaryType>(
      config,
      parameters,
      chain,
      signers,
    )
  }

  async function signIntent(
    signData: SignData,
    targetChain: DestinationChain,
    signers?: SignerSet,
  ): Promise<SignedIntentData> {
    const { originSignatures, destinationSignature } = await signIntentInternal(
      config,
      signData,
      targetChain,
      signers,
      false,
    )
    const targetExecutionSignature = await getTargetExecutionSignatureInternal(
      config,
      signData,
      targetChain,
      signers,
    )

    return {
      originSignatures,
      destinationSignature,
      targetExecutionSignature,
    }
  }

  function submitTransaction(
    signedTransaction: SignedTransactionData,
    options?: SubmitTransactionOptions,
  ) {
    return submitTransactionInternal(
      config,
      signedTransaction,
      options?.authorizations ?? [],
      options?.internal_dryRun ?? false,
    )
  }

  function prepareUserOperation(transaction: UserOperationTransaction) {
    return prepareUserOperationInternal(config, transaction)
  }

  function signUserOperation(preparedUserOperation: PreparedUserOperationData) {
    return signUserOperationInternal(config, preparedUserOperation)
  }
  function submitUserOperation(signedUserOperation: SignedUserOperationData) {
    return submitUserOperationInternal(config, signedUserOperation)
  }

  function sendUserOperation(transaction: UserOperationTransaction) {
    return sendUserOperationInternal(config, transaction)
  }

  function waitForExecution(
    result: TransactionResult,
  ): Promise<TransactionStatus>
  function waitForExecution(
    result: UserOperationResult,
  ): Promise<UserOperationReceipt>
  function waitForExecution(result: TransactionResult | UserOperationResult) {
    return waitForExecutionInternal(config, result)
  }

  function getAddress() {
    return getAddressInternal(config)
  }

  function getPortfolio(onTestnets = false) {
    return getPortfolioInternal(config, onTestnets)
  }

  function getOwners(chain: Chain) {
    const accountType = getAccountProvider(config).type
    const account = getAddress()
    // For HCA, the module lives behind the factory (custom factories define
    // their own). Resolve from the configured or initData factory so reads hit
    // the right module.
    const hcaFactory =
      config.account?.type === 'hca'
        ? (config.account.factory ??
          (config.initData && 'factory' in config.initData
            ? config.initData.factory
            : undefined))
        : undefined
    return getOwnersInternal(
      accountType,
      account,
      chain,
      config.provider,
      hcaFactory,
    )
  }

  function getValidators(chain: Chain) {
    const accountType = getAccountProvider(config).type
    const account = getAddress()
    return getValidatorsInternal(accountType, account, chain, config.provider)
  }

  function getExecutors(chain: Chain) {
    const accountType = getAccountProvider(config).type
    const account = getAddress()
    return getExecutorsInternal(accountType, account, chain, config.provider)
  }

  function experimental_getSessionDetails(sessions: Session[]) {
    const account = getAddress()
    return getSessionDetailsInternal(
      account,
      sessions,
      config.provider,
      config.useDevContracts,
    )
  }

  function experimental_isSessionEnabled(session: Session) {
    const account = getAddress()
    return isSessionEnabledInternal(
      account,
      config.provider,
      session,
      config.useDevContracts,
    )
  }

  function experimental_signEnableSession(details: SessionDetails) {
    return signEnableSessionInternal(config, details)
  }

  return {
    config,
    deploy,
    isDeployed,
    setup,
    signEip7702InitData,
    prepareTransaction,
    getTransactionMessages,
    signTransaction,
    assembleTransaction,
    signAuthorizations,
    signMessage,
    signTypedData,
    signIntent,
    submitTransaction,
    prepareUserOperation,
    signUserOperation,
    submitUserOperation,
    sendUserOperation,
    waitForExecution,
    getAddress,
    getPortfolio,
    getOwners,
    getValidators,
    getExecutors,
    experimental_getSessionDetails,
    experimental_isSessionEnabled,
    experimental_signEnableSession,
    getInitData,
  }
}

async function createSessionInternal<const TAbis extends readonly Abi[]>(
  authProvider: AuthProvider,
  endpointUrl: string | undefined,
  headers: Record<string, string> | undefined,
  useDevContracts: boolean | undefined,
  definition: SessionDefinition<TAbis>,
): Promise<Session> {
  const orchestrator = getOrchestrator(authProvider, endpointUrl, headers)
  const catalog = await orchestrator.getChainCatalog()
  const wrappedNativeToken = catalog.getWrappedNativeToken(definition.chain.id)
    ?.address as Address | undefined
  // Fail fast: without the wrapped-native address we can't add the native-wrap
  // `deposit()` permission, and a silently under-scoped session would
  // sign/enable fine but break native-wrap intents later.
  if (!wrappedNativeToken) {
    throw new Error(
      `createSession: the orchestrator's /chains has no wrapped-native token for chain ${definition.chain.id}. The chain must be supported and advertise its wrappedNativeToken.`,
    )
  }
  return toSession(definition, { wrappedNativeToken, useDevContracts })
}

/**
 * Stateful entry point that holds shared configuration (auth, provider, bundler,
 * paymaster) and creates accounts from it.
 */
class RhinestoneSDK {
  private authProvider: AuthProvider
  private endpointUrl?: string
  private provider?: ProviderConfig
  private bundler?: BundlerConfig
  private paymaster?: PaymasterConfig
  private useDevContracts?: boolean
  private headers?: Record<string, string>

  /**
   * Create a Rhinestone SDK instance.
   * @param options Shared configuration applied to every account created by this instance
   */
  constructor(options: RhinestoneSDKConfig) {
    this.authProvider = createAuthProvider(options)
    this.endpointUrl = options.endpointUrl
    this.provider = options.provider
    this.bundler = options.bundler
    this.paymaster = options.paymaster
    this.useDevContracts = options.useDevContracts
    this.headers = options.headers
  }

  /**
   * Create an account using this instance's shared configuration.
   * @param config Per-account configuration (owners, account type, modules, sessions)
   * @returns The account instance
   * @example
   * ```ts
   * import { RhinestoneSDK } from '@rhinestone/sdk'
   * import { privateKeyToAccount } from 'viem/accounts'
   *
   * const owner = privateKeyToAccount('0x...')
   *
   * const sdk = new RhinestoneSDK({
   *   auth: { mode: 'apiKey', apiKey: process.env.RHINESTONE_API_KEY! },
   * })
   *
   * const account = await sdk.createAccount({
   *   owners: { type: 'ecdsa', accounts: [owner] },
   * })
   * ```
   */
  createAccount(config: RhinestoneAccountConfig) {
    const rhinestoneConfig: RhinestoneConfig = {
      ...config,
      _authProvider: this.authProvider,
      endpointUrl: this.endpointUrl,
      provider: this.provider,
      bundler: this.bundler,
      paymaster: this.paymaster,
      useDevContracts: this.useDevContracts,
      headers: this.headers,
    }
    return createAccountInternal(rhinestoneConfig)
  }

  /**
   * Create a smart session, resolving the chain's wrapped-native token from the
   * orchestrator's chain catalog (`GET /chains`) so native-token wrapping is
   * permitted automatically. Project-scoped — needs the API key but no account.
   * For a fully offline build, use the standalone {@link toSession} and pass
   * `wrappedNativeToken` yourself.
   * @param definition The session definition
   * @returns The resolved session
   */
  createSession<const TAbis extends readonly Abi[]>(
    definition: SessionDefinition<TAbis>,
  ): Promise<Session> {
    return createSessionInternal(
      this.authProvider,
      this.endpointUrl,
      this.headers,
      this.useDevContracts,
      definition,
    )
  }

  /**
   * Get the current status of a submitted intent.
   * @param intentId The intent ID returned when the transaction was submitted
   * @returns The intent status
   */
  getIntentStatus(intentId: string) {
    return getIntentStatusInternal(
      this.authProvider,
      this.endpointUrl,
      intentId,
      this.headers,
    )
  }

  /**
   * Split a transaction into multiple intents across chains.
   * @param input The intents to split
   * @returns The split-intents result
   */
  splitIntents(input: SplitIntentsInput) {
    return splitIntentsInternal(
      this.authProvider,
      this.endpointUrl,
      input,
      this.headers,
    )
  }

  /**
   * Get the integrator's accrued app-fee balance, as USD totals.
   *
   * App fees are earned by the integrator identified by this instance's API key
   * (project-scoped, not tied to any account) and valued in USD at the moment
   * each fee is collected, so the balance is not affected by later price
   * movements of the collected tokens.
   * @returns The withdrawable and pending app-fee balances in USD
   */
  getAppFeeBalances(): Promise<AppFeeBalances> {
    return getAppFeeBalancesInternal(
      this.authProvider,
      this.endpointUrl,
      this.headers,
    )
  }
}

export {
  RhinestoneSDK,
  // Non-viem destination chain descriptors (Solana, Tron, HyperCore)
  hyperCoreMainnet,
  solanaMainnet,
  tronMainnet,
  // Validator addresses
  OWNABLE_VALIDATOR_ADDRESS,
  WEBAUTHN_VALIDATOR_ADDRESS,
  MULTI_FACTOR_VALIDATOR_ADDRESS,
  SMART_SESSION_EMISSARY_ADDRESS,
}
export type {
  RhinestoneAccount,
  AccountType,
  RhinestoneAccountConfig,
  AccountProviderConfig,
  ProviderConfig,
  BundlerConfig,
  PaymasterConfig,
  Transaction,
  TokenSymbol,
  CallInput,
  Call,
  TokenRequest,
  NonEvmTokenRequest,
  NonEvmTokenRequests,
  NonEvmAddress,
  OwnerSet,
  OwnableValidatorConfig,
  WebauthnValidatorConfig,
  MultiFactorValidatorConfig,
  SignerSet,
  SourceCallInput,
  SourceCallProvidedFunds,
  ChainSessionConfig,
  Session,
  SessionDefinition,
  Permission,
  PermissionFunctionConfig,
  ParamConstraint,
  Policy,
  Permit2ClaimPolicy,
  CrossChainPermissionInput,
  CrossChainPermit,
  FromLeg,
  ToLeg,
  CrossChainSettlementLayer,
  UniversalActionPolicyParamCondition,
  PreparedQuotes,
  PreparedTransactionData,
  Quote,
  QuoteSelection,
  SignAsOwnerOptions,
  SignedTransactionData,
  TransactionResult,
  PreparedUserOperationData,
  SignedUserOperationData,
  UserOperationResult,
  AuxiliaryFunds,
  BridgeFill,
  DestinationChain,
  NonEvmChain,
  IntentInput,
  IntentOpStatus,
  SettlementLayer,
  SettlementLayerFilter,
  SplitIntentsInput,
  SplitIntentsResult,
  Portfolio,
  TokenRequirements,
  WrapRequired,
  ApprovalRequired,
  // Intent signing
  OriginSignature,
  SignData,
  SignedIntentData,
  // Operation status types (blanc API)
  OperationStatus,
  FailureReason,
  ChainOperation,
  OwnerPasskeySignature,
  OwnerSignature,
  OwnerSignatureData,
}
