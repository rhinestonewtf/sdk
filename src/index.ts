import { RhinestoneAccountConfig, Transaction } from './types'
import {
  sendTransactions as sendTransactionsInternal,
  waitForExecution as waitForExecutionInternal,
} from './execution'
import { getAddress as getAddressInternal } from './accounts'

async function createRhinestoneAccount(config: RhinestoneAccountConfig) {
  const sendTransactions = async (transaction: Transaction) => {
    return await sendTransactionsInternal(config, transaction)
  }

  const waitForExecution = async ({ id }: { id: bigint }) => {
    return await waitForExecutionInternal(config, id)
  }

  const getAddress = async () => {
    return await getAddressInternal(config)
  }

  return {
    config,
    sendTransactions,
    waitForExecution,
    getAddress,
  }
}

export { createRhinestoneAccount }
