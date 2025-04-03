import {
  RhinestoneAccountConfig,
  Transaction,
} from './types';

import { sendTransactions as sendTransactionsInternal, waitForExecution as waitForExecutionInternal } from './services/transaction';
import { getAddress as getAddressInternal, deploy as deployInternal } from './services/account';
import { Chain } from 'viem/chains';
import { Account } from 'viem';

async function createRhinestoneAccount(config: RhinestoneAccountConfig) {
  const deploy = async (deployer: Account, chain: Chain) => {
    return await deployInternal(deployer, chain, config);
  }

  const sendTransactions = async (transaction: Transaction) => {
    return await sendTransactionsInternal(config, transaction);
  }

  const waitForExecution = async ({id}: { id: bigint }) => {
    return await waitForExecutionInternal(config, id);
  }

  const getAddress = async (chain: Chain) => {
    return await getAddressInternal(chain, config);
  }

  return {
    config,
    sendTransactions,
    waitForExecution,
    getAddress,
    deploy,
  }
}

export { createRhinestoneAccount };
