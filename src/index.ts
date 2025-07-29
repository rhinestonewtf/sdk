import type { Address, Chain, Hex, SignedAuthorizationList } from 'viem'
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
} from './accounts'
import { createTransport } from './accounts/utils'
import {
  addOwner,
  changeMultiFactorThreshold,
  changeThreshold,
  disableEcdsa,
  disableMultiFactor,
  disablePasskeys,
  enableEcdsa,
  enableMultiFactor,
  enablePasskeys,
  encodeSmartSessionSignature,
  recover,
  removeOwner,
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
  getEip7702InitData as getEip7702InitDataInternal,
  type IntentData,
  type PreparedTransactionData,
  prepareTransaction as prepareTransactionInternal,
  type SignedTransactionData,
  signTransaction as signTransactionInternal,
  submitTransaction as submitTransactionInternal,
} from './execution/utils'
import {
  getOwners as getOwnersInternal,
  getValidators as getValidatorsInternal,
} from './modules'
import {
  AuthenticationRequiredError,
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
  Transaction,
} from './types'

interface RhinestoneAccount {
  config: RhinestoneAccountConfig
  deploy: (chain: Chain, session?: Session) => Promise<void>
  getEip7702InitData: () => Promise<Hex>
  prepareTransaction: (
    transaction: Transaction,
  ) => Promise<PreparedTransactionData>
  signTransaction: (
    preparedTransaction: PreparedTransactionData,
  ) => Promise<SignedTransactionData>
  submitTransaction: (
    signedTransaction: SignedTransactionData,
    authorizations?: SignedAuthorizationList,
  ) => Promise<TransactionResult>
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
  function deploy(chain: Chain, session?: Session) {
    return deployInternal(config, chain, session)
  }

  function getEip7702InitData() {
    return getEip7702InitDataInternal(config)
  }

  function prepareTransaction(transaction: Transaction) {
    return prepareTransactionInternal(config, transaction)
  }

  function signTransaction(preparedTransaction: PreparedTransactionData) {
    return signTransactionInternal(config, preparedTransaction)
  }

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

  function getSessionDetails(
    sessions: Session[],
    sessionIndex: number,
    signature?: Hex,
  ) {
    return getSessionDetailsInternal(config, sessions, sessionIndex, signature)
  }

  function getOwners(chain: Chain) {
    const account = getAddress()
    return getOwnersInternal(account, chain, config.provider)
  }

  function getValidators(chain: Chain) {
    const accountType = config.account?.type || 'nexus'
    const account = getAddress()
    return getValidatorsInternal(accountType, account, chain, config.provider)
  }

  return {
    config,
    deploy,
    getEip7702InitData,
    prepareTransaction,
    signTransaction,
    submitTransaction,
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
  createTransport,
  // Actions
  addOwner,
  changeMultiFactorThreshold,
  changeThreshold,
  disableEcdsa,
  disableMultiFactor,
  disablePasskeys,
  enableEcdsa,
  enableMultiFactor,
  enablePasskeys,
  encodeSmartSessionSignature,
  recover,
  removeOwner,
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
