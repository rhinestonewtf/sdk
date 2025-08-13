import type {
  Address,
  Chain,
  HashTypedDataParameters,
  Hex,
  SignableMessage,
  SignedAuthorizationList,
  TypedData,
} from 'viem'
import type { UserOperationReceipt } from 'viem/account-abstraction'
import {
  AccountError,
  deploy as deployInternal,
  Eip7702AccountMustHaveEoaError,
  Eip7702NotSupportedForAccountError,
  ExistingEip7702AccountsNotSupportedError,
  FactoryArgsNotAvailableError,
  getAddress as getAddressInternal,
  isAccountError,
  SigningNotSupportedForAccountError,
  SignMessageNotSupportedByAccountError,
  SmartSessionsNotEnabledError,
  signEip7702InitData as signEip7702InitDataInternal,
} from './accounts'
import {
  addOwner,
  addPasskeyOwner,
  changeMultiFactorThreshold,
  changePasskeyThreshold,
  changeThreshold,
  disableEcdsa,
  disableMultiFactor,
  disablePasskeys,
  enableEcdsa,
  enableMultiFactor,
  enablePasskeys,
  encodeSmartSessionSignature,
  recover,
  recoverEcdsaOwnership,
  recoverPasskeyOwnership,
  removeOwner,
  removePasskeyOwner,
  removeSubValidator,
  setSubValidator,
  setUpRecovery,
} from './actions'
import type { TransactionResult } from './execution'
import {
  ExecutionError,
  getMaxSpendableAmount as getMaxSpendableAmountInternal,
  getPortfolio as getPortfolioInternal,
  IntentFailedError,
  isExecutionError,
  OrderPathRequiredForIntentsError,
  SessionChainRequiredError,
  SourceChainsNotAvailableForUserOpFlowError,
  sendTransaction as sendTransactionInternal,
  UserOperationRequiredForSmartSessionsError,
  waitForExecution as waitForExecutionInternal,
} from './execution'
import {
  getSessionDetails as getSessionDetailsInternal,
  type SessionDetails,
} from './execution/smart-session'
import {
  type IntentData,
  type PreparedTransactionData,
  prepareTransaction as prepareTransactionInternal,
  type SignedTransactionData,
  signAuthorizations as signAuthorizationsInternal,
  signMessage as signMessageInternal,
  signTransaction as signTransactionInternal,
  signTypedData as signTypedDataInternal,
  simulateTransaction as simulateTransactionInternal,
  submitTransaction as submitTransactionInternal,
} from './execution/utils'
import {
  getOwners as getOwnersInternal,
  getValidators as getValidatorsInternal,
} from './modules'
import {
  AuthenticationRequiredError,
  getSupportedTokens,
  getTokenAddress,
  InsufficientBalanceError,
  type IntentCost,
  type IntentInput,
  IntentNotFoundError,
  type IntentOp,
  type IntentOpStatus,
  type IntentResult,
  type IntentRoute,
  InvalidApiKeyError,
  InvalidIntentSignatureError,
  isOrchestratorError,
  NoPathFoundError,
  OnlyOneTargetTokenAmountCanBeUnsetError,
  OrchestratorError,
  type Portfolio,
  type SettlementSystem,
  type SignedIntentOp,
  TokenNotSupportedError,
  UnsupportedChainError,
  UnsupportedChainIdError,
  UnsupportedTokenError,
} from './orchestrator'
import type {
  Call,
  RhinestoneAccountConfig,
  Session,
  SignerSet,
  Transaction,
} from './types'

interface RhinestoneAccount {
  config: RhinestoneAccountConfig
  deploy: (chain: Chain, session?: Session) => Promise<void>
  signEip7702InitData: () => Promise<Hex>
  prepareTransaction: (
    transaction: Transaction,
  ) => Promise<PreparedTransactionData>
  signTransaction: (
    preparedTransaction: PreparedTransactionData,
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
    authorizations?: SignedAuthorizationList,
  ) => Promise<TransactionResult>
  simulateTransaction: (
    signedTransaction: SignedTransactionData,
    authorizations?: SignedAuthorizationList,
  ) => Promise<IntentResult>
  sendTransaction: (transaction: Transaction) => Promise<TransactionResult>
  waitForExecution: (
    result: TransactionResult,
    acceptsPreconfirmations?: boolean,
  ) => Promise<IntentOpStatus | UserOperationReceipt>
  getAddress: () => Address
  getPortfolio: (onTestnets?: boolean) => Promise<Portfolio>
  getMaxSpendableAmount: (
    chain: Chain,
    tokenAddress: Address,
    gasUnits: bigint,
  ) => Promise<bigint>
  getSessionDetails: (
    sessions: Session[],
    sessionIndex: number,
    signature?: Hex,
  ) => Promise<SessionDetails>
  getOwners: (chain: Chain) => Promise<{
    accounts: Address[]
    threshold: number
  } | null>
  getValidators: (chain: Chain) => Promise<Address[]>
}

/**
 * Initialize a Rhinestone account
 * Note: accounts are deployed onchain only when the first transaction is sent.
 * @param config Account config (e.g. implementation vendor, owner signers, smart sessions)
 * @returns account
 */
async function createRhinestoneAccount(
  config: RhinestoneAccountConfig,
): Promise<RhinestoneAccount> {
  /**
   * Deploys the account on a given chain
   * @param chain Chain to deploy the account on
   * @param session Session to deploy the account on (optional)
   */
  function deploy(chain: Chain, session?: Session) {
    return deployInternal(config, chain, session)
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
   * Sign a transaction
   * @param preparedTransaction Prepared transaction data
   * @returns signed transaction data
   * @see {@link prepareTransaction} to prepare the transaction data for signing
   */
  function signTransaction(preparedTransaction: PreparedTransactionData) {
    return signTransactionInternal(config, preparedTransaction)
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
   * @param authorizations EIP-7702 authorizations to submit (optional)
   * @returns transaction result object (an intent ID or a UserOp hash)
   * @see {@link signTransaction} to sign the transaction data
   * @see {@link signAuthorizations} to sign the required EIP-7702 authorizations
   */
  function submitTransaction(
    signedTransaction: SignedTransactionData,
    authorizations?: SignedAuthorizationList,
  ) {
    return submitTransactionInternal(
      config,
      signedTransaction,
      authorizations ?? [],
    )
  }

  /**
   * Simulate a transaction
   * @param signedTransaction Signed transaction data
   * @param authorizations EIP-7702 authorizations to simulate (optional)
   * @returns simulation result
   * @see {@link signTransaction} to sign the transaction data
   * @see {@link signAuthorizations} to sign the required EIP-7702 authorizations
   */
  function simulateTransaction(
    signedTransaction: SignedTransactionData,
    authorizations?: SignedAuthorizationList,
  ) {
    return simulateTransactionInternal(
      config,
      signedTransaction,
      authorizations ?? [],
    )
  }

  /**
   * Sign and send a transaction
   * @param transaction Transaction to send
   * @returns transaction result object (an intent ID or a UserOp hash)
   */
  function sendTransaction(transaction: Transaction) {
    return sendTransactionInternal(config, transaction)
  }

  /**
   * Wait for the transaction execution onchain
   * @param result transaction result object
   * @param acceptsPreconfirmations whether to accept preconfirmations from relayers before the transaction lands onchain (enabled by default)
   * @returns intent result or a UserOp receipt
   */
  function waitForExecution(
    result: TransactionResult,
    acceptsPreconfirmations = true,
  ) {
    return waitForExecutionInternal(config, result, acceptsPreconfirmations)
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
   * Get the maximum spendable token amount on the target chain
   * @param chain Target chain
   * @param tokenAddress Token address (on the target chain)
   * @param gasUnits Gas cost estimate for the transaction execution
   * @returns Maximum spendable amount in absolute units
   */
  function getMaxSpendableAmount(
    chain: Chain,
    tokenAddress: Address,
    gasUnits: bigint,
  ) {
    return getMaxSpendableAmountInternal(config, chain, tokenAddress, gasUnits)
  }

  /**
   * Get account owners (ECDSA)
   * @param chain Chain to get the owners on
   * @returns Account owners
   */
  function getOwners(chain: Chain) {
    const account = getAddress()
    return getOwnersInternal(account, chain, config.provider)
  }

  /**
   * Get account validator modules
   * @param chain Chain to get the validators on
   * @returns List of account validators
   */
  function getValidators(chain: Chain) {
    const accountType = config.account?.type || 'nexus'
    const account = getAddress()
    return getValidatorsInternal(accountType, account, chain, config.provider)
  }

  function getSessionDetails(
    sessions: Session[],
    sessionIndex: number,
    signature?: Hex,
  ) {
    return getSessionDetailsInternal(config, sessions, sessionIndex, signature)
  }

  return {
    config,
    deploy,
    signEip7702InitData,
    prepareTransaction,
    signTransaction,
    signAuthorizations,
    signMessage,
    signTypedData,
    submitTransaction,
    simulateTransaction,
    sendTransaction,
    waitForExecution,
    getAddress,
    getPortfolio,
    getMaxSpendableAmount,
    getSessionDetails,
    getOwners,
    getValidators,
  }
}

export {
  createRhinestoneAccount,
  // Actions
  addOwner,
  addPasskeyOwner,
  changeMultiFactorThreshold,
  changeThreshold,
  changePasskeyThreshold,
  disableEcdsa,
  disableMultiFactor,
  disablePasskeys,
  enableEcdsa,
  enableMultiFactor,
  enablePasskeys,
  encodeSmartSessionSignature,
  recover,
  recoverEcdsaOwnership,
  recoverPasskeyOwnership,
  removeOwner,
  removePasskeyOwner,
  removeSubValidator,
  setSubValidator,
  setUpRecovery,
  // Account errors
  isAccountError,
  AccountError,
  Eip7702AccountMustHaveEoaError,
  ExistingEip7702AccountsNotSupportedError,
  FactoryArgsNotAvailableError,
  SmartSessionsNotEnabledError,
  SigningNotSupportedForAccountError,
  SignMessageNotSupportedByAccountError,
  Eip7702NotSupportedForAccountError,
  // Execution errors
  isExecutionError,
  IntentFailedError,
  ExecutionError,
  SourceChainsNotAvailableForUserOpFlowError,
  UserOperationRequiredForSmartSessionsError,
  OrderPathRequiredForIntentsError,
  SessionChainRequiredError,
  // Orchestrator errors
  isOrchestratorError,
  AuthenticationRequiredError,
  InsufficientBalanceError,
  InvalidApiKeyError,
  InvalidIntentSignatureError,
  NoPathFoundError,
  OnlyOneTargetTokenAmountCanBeUnsetError,
  OrchestratorError,
  IntentNotFoundError,
  TokenNotSupportedError,
  UnsupportedChainError,
  UnsupportedChainIdError,
  UnsupportedTokenError,
  // Registry functions
  getSupportedTokens,
  getTokenAddress,
}
export type {
  RhinestoneAccount,
  Session,
  Call,
  IntentData,
  PreparedTransactionData,
  SignedTransactionData,
  TransactionResult,
  IntentCost,
  IntentInput,
  IntentOp,
  IntentOpStatus,
  IntentResult,
  IntentRoute,
  SettlementSystem,
  SignedIntentOp,
  Portfolio,
}
