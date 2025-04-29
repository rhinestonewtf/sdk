import { getAddress as getAddressInternal } from './accounts'
import type { TransactionResult } from './execution'
import {
  sendTransaction as sendTransactionInternal,
  waitForExecution as waitForExecutionInternal,
} from './execution'
import type { RhinestoneAccountConfig, Session, Transaction } from './types'

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
  function sendTransactions(transaction: Transaction) {
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
  function getAddress(): string {
    return getAddressInternal(config)
  }

  return {
    config,
    sendTransactions,
    waitForExecution,
    getAddress,
  }
}

export { createRhinestoneAccount }
export type { Session }
