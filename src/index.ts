import { Chain } from 'viem/chains'

import { RhinestoneAccountConfig, Transaction } from './types'
import {
  sendTransactions as sendTransactionsInternal,
  waitForExecution as waitForExecutionInternal,
} from './services/transaction'
import { getAddress as getAddressInternal } from './services/account'

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
