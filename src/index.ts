import { Address, Chain } from 'viem'
import { getAddress as getAddressInternal } from './accounts'
import type { TransactionResult } from './execution'
import {
  getMaxSpendableAmount as getMaxSpendableAmountInternal,
  getPortfolio as getPortfolioInternal,
  sendTransaction as sendTransactionInternal,
  waitForExecution as waitForExecutionInternal,
} from './execution'
import type {
  BundleStatus,
  MetaIntent,
  MultiChainCompact,
  PostOrderBundleResult,
  SignedMultiChainCompact,
} from './orchestrator'
import type {
  Call,
  Execution,
  RhinestoneAccountConfig,
  Session,
  Transaction,
} from './types'

/**
 * Initialize a Rhinestone account
 * Note: accounts are deployed onchain only when the first transaction is sent.
 * @param config Account config (e.g. implementation vendor, owner signers, smart sessions)
 * @returns account
 */
async function createRhinestoneAccount(config: RhinestoneAccountConfig) {
  /**
   * Sign and send a transaction
   * @param transaction Transaction to send
   * @returns transaction result object (a bundle ID or a UserOp hash)
   */
  function sendTransaction(transaction: Transaction) {
    return sendTransactionInternal(config, transaction)
  }

  /**
   * Wait for the transaction execution onchain
   * @param result transaction result object
   * @returns bundle result or a UserOp receipt
   */
  function waitForExecution(result: TransactionResult) {
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

  return {
    config,
    sendTransaction,
    waitForExecution,
    getAddress,
    getPortfolio,
    getMaxSpendableAmount,
  }
}

export { createRhinestoneAccount }
export type {
  BundleStatus,
  Session,
  Call,
  Execution,
  MetaIntent,
  MultiChainCompact,
  PostOrderBundleResult,
  SignedMultiChainCompact,
}
