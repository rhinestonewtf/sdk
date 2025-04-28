import { getAddress as getAddressInternal } from './accounts'
import type { TransactionResult } from './execution'
import {
  sendTransaction as sendTransactionInternal,
  waitForExecution as waitForExecutionInternal,
} from './execution'
import type { RhinestoneAccountConfig, Session, Transaction } from './types'

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
export type { Session }
