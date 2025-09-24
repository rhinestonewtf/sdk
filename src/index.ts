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
  checkAddress,
  deploy as deployInternal,
  getAddress as getAddressInternal,
  isDeployed as isDeployedInternal,
  OwnersFieldRequiredError,
  setup as setupInternal,
  signEip7702InitData as signEip7702InitDataInternal,
} from './accounts'
import { walletClientToAccount } from './accounts/walletClient'
import { encodeSmartSessionSignature } from './actions/smart-session'
import {
  getMaxSpendableAmount as getMaxSpendableAmountInternal,
  getPortfolio as getPortfolioInternal,
  sendTransaction as sendTransactionInternal,
  sendUserOperation as sendUserOperationInternal,
  type TransactionResult,
  type TransactionStatus,
  type UserOperationResult,
  waitForExecution as waitForExecutionInternal,
} from './execution'
import {
  type BatchPermit2Result,
  checkERC20AllowanceDirect,
  checkERC20Allowance as checkERC20AllowanceInternal,
  getPermit2Address,
  type MultiChainPermit2Config,
  type MultiChainPermit2Result,
  signPermit2Batch,
  signPermit2Sequential,
} from './execution/permit2'
import {
  getSessionDetails as getSessionDetailsInternal,
  type SessionDetails,
} from './execution/smart-session'
import {
  type IntentRoute,
  type PreparedTransactionData,
  type PreparedUserOperationData,
  prepareTransaction as prepareTransactionInternal,
  prepareUserOperation as prepareUserOperationInternal,
  type SignedTransactionData,
  type SignedUserOperationData,
  signAuthorizations as signAuthorizationsInternal,
  signMessage as signMessageInternal,
  signTransaction as signTransactionInternal,
  signTypedData as signTypedDataInternal,
  signUserOperation as signUserOperationInternal,
  simulateTransaction as simulateTransactionInternal,
  submitTransaction as submitTransactionInternal,
  submitUserOperation as submitUserOperationInternal,
} from './execution/utils'
import {
  getOwners as getOwnersInternal,
  getValidators as getValidatorsInternal,
} from './modules'
import {
  getSupportedTokens,
  getTokenAddress,
  type IntentCost,
  type IntentInput,
  type IntentOp,
  type IntentOpStatus,
  type IntentResult,
  type Portfolio,
  type SettlementSystem,
  type SignedIntentOp,
} from './orchestrator'
import type {
  AccountProviderConfig,
  AccountType,
  BundlerConfig,
  Call,
  CallInput,
  MultiFactorValidatorConfig,
  OwnableValidatorConfig,
  OwnerSet,
  PaymasterConfig,
  Policy,
  ProviderConfig,
  Recovery,
  RhinestoneAccountConfig,
  RhinestoneConfig,
  Session,
  SignerSet,
  TokenRequest,
  TokenSymbol,
  Transaction,
  UniversalActionPolicyParamCondition,
  UserOperationTransaction,
  WebauthnValidatorConfig,
} from './types'

interface RhinestoneAccount {
  config: RhinestoneAccountConfig
  deploy: (chain: Chain, session?: Session) => Promise<boolean>
  isDeployed: (chain: Chain) => Promise<boolean>
  setup: (chain: Chain) => Promise<boolean>
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
  waitForExecution(
    result: TransactionResult,
    acceptsPreconfirmations?: boolean,
  ): Promise<TransactionStatus>
  waitForExecution(
    result: UserOperationResult,
    acceptsPreconfirmations?: boolean,
  ): Promise<UserOperationReceipt>
  getAddress: () => Address
  getPortfolio: (onTestnets?: boolean) => Promise<Portfolio>
  getMaxSpendableAmount: (
    chain: Chain,
    tokenAddress: Address,
    gasUnits: bigint,
    sponsored?: boolean,
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
  checkERC20Allowance: (tokenAddress: Address, chain: Chain) => Promise<bigint>
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
  function deploy(chain: Chain, session?: Session) {
    return deployInternal(config, chain, session)
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
   * @returns transaction result object (a UserOp hash)
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
   * Simulate a transaction
   * @param signedTransaction Signed transaction data
   * @param authorizations EIP-7702 authorizations to simulate (optional)
   * @returns simulation result
   * @see {@link sendTransaction} to send the transaction
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
   * @returns transaction result object (an intent ID)
   */
  function sendTransaction(transaction: Transaction) {
    return sendTransactionInternal(config, transaction)
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
   * Wait for the transaction execution onchain
   * @param result transaction result object
   * @param acceptsPreconfirmations whether to accept preconfirmations from relayers before the transaction lands onchain (enabled by default)
   * @returns intent result or a UserOp receipt
   */
  function waitForExecution(
    result: TransactionResult,
    acceptsPreconfirmations?: boolean,
  ): Promise<TransactionStatus>
  function waitForExecution(
    result: UserOperationResult,
    acceptsPreconfirmations?: boolean,
  ): Promise<UserOperationReceipt>
  function waitForExecution(
    result: TransactionResult | UserOperationResult,
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
    sponsored: boolean = false,
  ) {
    return getMaxSpendableAmountInternal(
      config,
      chain,
      tokenAddress,
      gasUnits,
      sponsored,
    )
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

  /**
   * Check ERC20 allowance for the account owner and token (using Permit2 as spender)
   * @param tokenAddress The token contract address
   * @param chain The chain to check the allowance on
   * @returns The allowance amount
   */
  function checkERC20Allowance(tokenAddress: Address, chain: Chain) {
    if (!config.provider) {
      throw new Error('Provider configuration is required')
    }
    return checkERC20AllowanceInternal(tokenAddress, chain, config)
  }

  return {
    config,
    deploy,
    isDeployed,
    setup,
    signEip7702InitData,
    prepareTransaction,
    signTransaction,
    signAuthorizations,
    signMessage,
    signTypedData,
    submitTransaction,
    simulateTransaction,
    prepareUserOperation,
    signUserOperation,
    submitUserOperation,
    sendTransaction,
    sendUserOperation,
    waitForExecution,
    getAddress,
    getPortfolio,
    getMaxSpendableAmount,
    getSessionDetails,
    getOwners,
    getValidators,
    checkERC20Allowance,
  }
}

class RhinestoneSDK {
  private apiKey?: string
  private endpointUrl?: string
  private provider?: ProviderConfig
  private bundler?: BundlerConfig
  private paymaster?: PaymasterConfig

  constructor(options?: {
    apiKey?: string
    endpointUrl?: string
    provider?: ProviderConfig
    bundler?: BundlerConfig
    paymaster?: PaymasterConfig
  }) {
    this.apiKey = options?.apiKey
    this.endpointUrl = options?.endpointUrl
    this.provider = options?.provider
    this.bundler = options?.bundler
    this.paymaster = options?.paymaster
  }

  createAccount(config: RhinestoneAccountConfig) {
    const rhinestoneConfig: RhinestoneConfig = {
      ...config,
      apiKey: this.apiKey,
      endpointUrl: this.endpointUrl,
      provider: this.provider,
      bundler: this.bundler,
      paymaster: this.paymaster,
    }
    return createRhinestoneAccount(rhinestoneConfig)
  }
}

export {
  RhinestoneSDK,
  walletClientToAccount,
  encodeSmartSessionSignature,
  // Registry functions
  getSupportedTokens,
  getTokenAddress,
  // Permit2 helpers
  checkERC20AllowanceDirect,
  getPermit2Address,
  // Multi-chain permit2 signing
  signPermit2Batch,
  signPermit2Sequential,
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
  OwnerSet,
  OwnableValidatorConfig,
  WebauthnValidatorConfig,
  MultiFactorValidatorConfig,
  SignerSet,
  Session,
  Recovery,
  Policy,
  UniversalActionPolicyParamCondition,
  PreparedTransactionData,
  SignedTransactionData,
  TransactionResult,
  PreparedUserOperationData,
  SignedUserOperationData,
  UserOperationResult,
  IntentCost,
  IntentInput,
  IntentOp,
  IntentOpStatus,
  IntentRoute,
  SettlementSystem,
  SignedIntentOp,
  Portfolio,
  // Multi-chain permit2 types
  MultiChainPermit2Config,
  MultiChainPermit2Result,
  BatchPermit2Result,
}
