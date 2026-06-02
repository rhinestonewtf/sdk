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
  getTransactionMessages as getTransactionMessagesInternal,
  type PreparedQuotes,
  type PreparedTransactionData,
  type PreparedUserOperationData,
  prepareTransaction as prepareTransactionInternal,
  prepareUserOperation as prepareUserOperationInternal,
  type QuoteSelection,
  type SignedTransactionData,
  type SignedUserOperationData,
  signAuthorizations as signAuthorizationsInternal,
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
} from './modules/validators/smart-sessions'
import type {
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
  SplitIntentsInput,
  SplitIntentsResult,
  TokenRequirements,
  WrapRequired,
} from './orchestrator'
import { hyperCoreMainnet, solanaMainnet, tronMainnet } from './orchestrator'
import type {
  AccountProviderConfig,
  AccountType,
  BundlerConfig,
  Call,
  CallInput,
  ChainSessionConfig,
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
  Recovery,
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
  config: RhinestoneAccountConfig
  deploy: (
    chain: Chain,
    params?: { session?: Session; sponsored?: boolean },
  ) => Promise<boolean>
  isDeployed: (chain: Chain) => Promise<boolean>
  setup: (chain: Chain) => Promise<boolean>
  getInitData(): {
    factory: Address
    factoryData: Hex
  }
  signEip7702InitData: () => Promise<Hex>
  prepareTransaction: (
    transaction: Transaction,
  ) => Promise<PreparedTransactionData>
  getTransactionMessages: (
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ) => {
    origin: TypedDataDefinition[]
    destination: TypedDataDefinition
    targetExecution?: TypedDataDefinition
  }
  signTransaction: (
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ) => Promise<SignedTransactionData>
  signAuthorizations: (
    preparedTransaction: PreparedTransactionData,
  ) => Promise<SignedAuthorizationList>
  signMessage: (
    message: SignableMessage,
    chain: Chain,
    signers: SignerSet | undefined,
  ) => Promise<Hex>
  signTypedData: <
    typedData extends TypedData | Record<string, unknown> = TypedData,
    primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
  >(
    parameters: HashTypedDataParameters<typedData, primaryType>,
    chain: Chain,
    signers: SignerSet | undefined,
  ) => Promise<Hex>
  submitTransaction: (
    signedTransaction: SignedTransactionData,
    options?: SubmitTransactionOptions,
  ) => Promise<TransactionResult>
  prepareUserOperation: (
    transaction: UserOperationTransaction,
  ) => Promise<PreparedUserOperationData>
  signUserOperation: (
    preparedUserOperation: PreparedUserOperationData,
  ) => Promise<SignedUserOperationData>
  submitUserOperation: (
    signedUserOperation: SignedUserOperationData,
  ) => Promise<UserOperationResult>
  sendUserOperation: (
    transaction: UserOperationTransaction,
  ) => Promise<UserOperationResult>
  waitForExecution(result: TransactionResult): Promise<TransactionStatus>
  waitForExecution(result: UserOperationResult): Promise<UserOperationReceipt>
  getAddress: () => Address
  getPortfolio: (onTestnets?: boolean) => Promise<Portfolio>
  experimental_getSessionDetails: (
    sessions: Session[],
  ) => Promise<SessionDetails>
  experimental_isSessionEnabled: (session: Session) => Promise<boolean>
  experimental_signEnableSession: (details: SessionDetails) => Promise<Hex>
  getOwners: (chain: Chain) => Promise<{
    accounts: Address[]
    threshold: number
  } | null>
  getValidators: (chain: Chain) => Promise<Address[]>
  getExecutors: (chain: Chain) => Promise<Address[]>
}

/**
 * Initialize a Rhinestone account
 * Note: accounts are deployed onchain only when the first transaction is sent.
 * @param config Account config (e.g. implementation vendor, owner signers, smart sessions)
 * @returns account
 */
async function createRhinestoneAccount(
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
   * @param session Session to deploy the account on (optional)
   */
  function deploy(
    chain: Chain,
    params?: { session?: Session; sponsored?: boolean },
  ) {
    return deployInternal(config, chain, params)
  }

  /**
   * Checks if the account is deployed on a given chain
   * @param chain Chain to check if the account is deployed on
   * @returns true if the account is deployed, false otherwise
   */
  function isDeployed(chain: Chain) {
    return isDeployedInternal(config, chain)
  }

  /**
   * Sets up the existing account on a given chain
   * by installing the missing modules (if any).
   * @param chain Chain to set up the account on
   */
  function setup(chain: Chain) {
    return setupInternal(config, chain)
  }

  /**
   * Get the account initialization data. Used for deploying the account onchain.
   * @returns factory address and factory data
   */
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

  /**
   * Prepare and sign the EIP-7702 account initialization data
   * @returns init data signature
   */
  function signEip7702InitData() {
    return signEip7702InitDataInternal(config)
  }

  /**
   * Prepare a transaction data
   * @param transaction Transaction to prepare
   * @returns prepared transaction data
   */
  function prepareTransaction(transaction: Transaction) {
    return prepareTransactionInternal(config, transaction)
  }

  /**
   * Get the transaction typed data message to sign
   * @param preparedTransaction Prepared transaction data
   * @param options Optional override; pass `{ intentId }` to inspect a specific quote from `preparedTransaction.quotes.all`
   * @see {@link prepareTransaction} to prepare the transaction data for signing
   */
  function getTransactionMessages(
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ) {
    return getTransactionMessagesInternal(config, preparedTransaction, options)
  }

  /**
   * Sign a transaction
   * @param preparedTransaction Prepared transaction data
   * @param options Optional override; pass `{ intentId }` to sign a specific quote from `preparedTransaction.quotes.all`
   * @returns signed transaction data
   * @see {@link prepareTransaction} to prepare the transaction data for signing
   */
  function signTransaction(
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ) {
    return signTransactionInternal(config, preparedTransaction, options)
  }

  /**
   * Sign the required EIP-7702 authorizations for a transaction
   * @param preparedTransaction Prepared transaction data
   * @returns signed authorizations
   * @see {@link prepareTransaction} to prepare the transaction data for signing
   */
  function signAuthorizations(preparedTransaction: PreparedTransactionData) {
    return signAuthorizationsInternal(config, preparedTransaction)
  }

  /**
   * Sign a message (EIP-191)
   * @param message Message to sign
   * @param chain Chain to sign the message on
   * @param signers Signers to use for signing
   * @returns signature
   */
  function signMessage(
    message: SignableMessage,
    chain: Chain,
    signers: SignerSet | undefined,
  ) {
    return signMessageInternal(config, message, chain, signers)
  }

  /**
   * Sign a typed data (EIP-712)
   * @param parameters Typed data parameters
   * @param chain Chain to sign the typed data on
   * @param signers Signers to use for signing
   * @returns signature
   */
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

  /**
   * Submit a transaction
   * @param signedTransaction Signed transaction data
   * @param options Optional submission options
   * @param options.authorizations EIP-7702 authorizations to submit
   * @returns transaction result object (a UserOp hash)
   * @see {@link signTransaction} to sign the transaction data
   * @see {@link signAuthorizations} to sign the required EIP-7702 authorizations
   */
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

  /**
   * Prepare a user operation data
   * @param transaction User operation to prepare
   * @returns prepared user operation data
   */
  function prepareUserOperation(transaction: UserOperationTransaction) {
    return prepareUserOperationInternal(config, transaction)
  }

  /**
   * Sign a user operation
   * @param preparedUserOperation Prepared user operation data
   * @returns signed user operation data
   * @see {@link prepareUserOperation} to prepare the user operation data for signing
   */
  function signUserOperation(preparedUserOperation: PreparedUserOperationData) {
    return signUserOperationInternal(config, preparedUserOperation)
  }
  /**
   * Submit a transaction
   * @param signedTransaction Signed transaction data
   * @returns transaction result object (a UserOp hash)
   * @see {@link signUserOperation} to sign the user operation data
   */
  function submitUserOperation(signedUserOperation: SignedUserOperationData) {
    return submitUserOperationInternal(config, signedUserOperation)
  }

  /**
   * Sign and send a user operation
   * @param transaction User operation to send
   * @returns user operation result object (a UserOp hash)
   */
  function sendUserOperation(transaction: UserOperationTransaction) {
    return sendUserOperationInternal(config, transaction)
  }

  /**
   * Wait for the transaction execution onchain.
   *
   * Polls the orchestrator until the intent reaches a terminal state
   * (`COMPLETED` or `FAILED`). On failure an {@link IntentFailedError} is thrown.
   *
   * @param result Transaction result object returned by {@link sendTransaction}
   * @returns Per-chain operation breakdown (for intents) or a UserOp receipt
   */
  function waitForExecution(
    result: TransactionResult,
  ): Promise<TransactionStatus>
  function waitForExecution(
    result: UserOperationResult,
  ): Promise<UserOperationReceipt>
  function waitForExecution(result: TransactionResult | UserOperationResult) {
    return waitForExecutionInternal(config, result)
  }

  /**
   * Get account address
   * @returns Address of the smart account
   */
  function getAddress() {
    return getAddressInternal(config)
  }

  /**
   * Get account portfolio
   * @param onTestnets Whether to query the testnet balances (default is `false`)
   * @returns Account balances
   */
  function getPortfolio(onTestnets = false) {
    return getPortfolioInternal(config, onTestnets)
  }

  /**
   * Get account owners (ECDSA)
   * @param chain Chain to get the owners on
   * @returns Account owners
   */
  function getOwners(chain: Chain) {
    const accountType = getAccountProvider(config).type
    const account = getAddress()
    return getOwnersInternal(accountType, account, chain, config.provider)
  }

  /**
   * Get account validator modules
   * @param chain Chain to get the validators on
   * @returns List of account validators
   */
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
    signAuthorizations,
    signMessage,
    signTypedData,
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

class RhinestoneSDK {
  private authProvider: AuthProvider
  private endpointUrl?: string
  private provider?: ProviderConfig
  private bundler?: BundlerConfig
  private paymaster?: PaymasterConfig
  private useDevContracts?: boolean
  private headers?: Record<string, string>

  constructor(options: RhinestoneSDKConfig) {
    this.authProvider = createAuthProvider(options)
    this.endpointUrl = options.endpointUrl
    this.provider = options.provider
    this.bundler = options.bundler
    this.paymaster = options.paymaster
    this.useDevContracts = options.useDevContracts
    this.headers = options.headers
  }

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
    return createRhinestoneAccount(rhinestoneConfig)
  }

  getIntentStatus(intentId: string) {
    return getIntentStatusInternal(
      this.authProvider,
      this.endpointUrl,
      intentId,
      this.headers,
    )
  }

  splitIntents(input: SplitIntentsInput) {
    return splitIntentsInternal(
      this.authProvider,
      this.endpointUrl,
      input,
      this.headers,
    )
  }
}

export {
  RhinestoneSDK,
  createRhinestoneAccount,
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
  Recovery,
  Permission,
  PermissionFunctionConfig,
  ParamConstraint,
  Policy,
  Permit2ClaimPolicy,
  UniversalActionPolicyParamCondition,
  PreparedQuotes,
  PreparedTransactionData,
  Quote,
  QuoteSelection,
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
  // Operation status types (blanc API)
  OperationStatus,
  FailureReason,
  ChainOperation,
}
