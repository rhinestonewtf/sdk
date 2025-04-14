import { RhinestoneAccountConfig, Transaction } from './types'
import {
  sendTransaction as sendTransactionInternal,
  waitForExecution as waitForExecutionInternal,
} from './execution'
import { getAddress as getAddressInternal } from './accounts'

async function createRhinestoneAccount(config: RhinestoneAccountConfig) {
  function sendTransactions(transaction: Transaction) {
    return sendTransactionInternal(config, transaction)
  }

  function waitForExecution({ id }: { id: bigint }) {
    return waitForExecutionInternal(config, id)
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
