import { RhinestoneAccountConfig, Transaction } from './types'
import {
  type TransactionResult,
  sendTransaction as sendTransactionInternal,
  waitForExecution as waitForExecutionInternal,
} from './execution'
import { getAddress as getAddressInternal } from './accounts'

async function createRhinestoneAccount(config: RhinestoneAccountConfig) {
  function sendTransactions(transaction: Transaction) {
    return sendTransactionInternal(config, transaction)
  }

  function waitForExecution(result: TransactionResult) {
    return waitForExecutionInternal(config, result)
  }

  function getAddress() {
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
