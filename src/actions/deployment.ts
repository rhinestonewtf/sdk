import type { Address, Chain, Hex } from 'viem'
import { createPublicClient, createWalletClient } from 'viem'
import {
  getAddress as getAddressInternal,
  getInitCode as getInitCodeInternal,
  isDeployed as isDeployedInternal,
} from '../accounts'
import { createTransport } from '../accounts/utils'
import type {
  AccountProviderConfig,
  RhinestoneConfig,
  RhinestoneSDKConfig,
} from '../types'

async function deployWithCustomFactory(
  sponsorConfig: RhinestoneConfig,
  chain: Chain,
  factoryArgs: { factory: Address; factoryData: Hex },
) {
  const sponsorOwners = sponsorConfig.owners
  if (
    !sponsorOwners ||
    sponsorOwners.type !== 'ecdsa' ||
    sponsorOwners.accounts.length === 0
  ) {
    throw new Error('Sponsor must have an ECDSA account')
  }

  const sponsorAccount = sponsorOwners.accounts[0]
  if (!('signTransaction' in sponsorAccount)) {
    throw new Error('Sponsor account must be able to sign transactions')
  }

  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, sponsorConfig.provider),
  })

  const walletClient = createWalletClient({
    account: sponsorAccount,
    chain,
    transport: createTransport(chain, sponsorConfig.provider),
  })

  const hash = await walletClient.sendTransaction({
    to: factoryArgs.factory,
    data: factoryArgs.factoryData,
    value: 0n,
  })

  await publicClient.waitForTransactionReceipt({ hash })
}

/**
 * Deploy smart accounts for multiple users from a backend using a sponsor wallet.
 * The sponsor pays for gas, but users own and control their accounts.
 */
async function deployAccountsForOwners(params: {
  sponsorAccount: import('viem').Account
  ownerAddresses: Address[]
  accountConfig: AccountProviderConfig
  chain: Chain
  sdkConfig?: RhinestoneSDKConfig
  sponsored?: boolean
}): Promise<Array<{ owner: Address; account: Address }>> {
  const { sponsorAccount, ownerAddresses, accountConfig, chain, sdkConfig } =
    params

  const results: Array<{ owner: Address; account: Address }> = []

  for (const ownerAddress of ownerAddresses) {
    const ownerAccountRef = {
      address: ownerAddress,
      type: 'json-rpc' as const,
    }

    const userConfig: RhinestoneConfig = {
      account: accountConfig,
      owners: {
        type: 'ecdsa',
        accounts: [ownerAccountRef],
        threshold: 1,
      },
      ...sdkConfig,
    }

    const accountAddress = getAddressInternal(userConfig)
    const isAlreadyDeployed = await isDeployedInternal(userConfig, chain)

    if (isAlreadyDeployed) {
      results.push({ owner: ownerAddress, account: accountAddress })
      continue
    }

    const sponsorConfig: RhinestoneConfig = {
      account: accountConfig,
      owners: {
        type: 'ecdsa',
        accounts: [sponsorAccount],
        threshold: 1,
      },
      ...sdkConfig,
    }

    const initCode = getInitCodeInternal(userConfig)
    if (!initCode || !('factory' in initCode)) {
      throw new Error('Failed to get init code for account deployment')
    }

    await deployWithCustomFactory(sponsorConfig, chain, initCode)

    results.push({ owner: ownerAddress, account: accountAddress })
  }

  return results
}

export { deployAccountsForOwners }
