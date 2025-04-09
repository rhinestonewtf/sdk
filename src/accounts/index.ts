import {
  Account,
  Chain,
  createPublicClient,
  http,
  createWalletClient,
  size,
  keccak256,
  encodePacked,
  slice,
  PublicClient,
} from 'viem'

import { RhinestoneAccountConfig } from '../types'

import {
  getDeployArgs as getSafeDeployArgs,
  get7702InitCalls as get7702SafeInitCalls,
  get7702SmartAccount as get7702SafeAccount,
} from './safe'
import {
  getDeployArgs as getNexusDeployArgs,
  get7702InitCalls as get7702NexusInitCalls,
  get7702SmartAccount as get7702NexusAccount,
} from './nexus'
import { getBundlerClient } from './utils'

async function getDeployArgs(config: RhinestoneAccountConfig) {
  switch (config.account.type) {
    case 'safe': {
      return getSafeDeployArgs(config)
    }
    case 'nexus': {
      return getNexusDeployArgs(config)
    }
  }
}

async function getAddress(config: RhinestoneAccountConfig) {
  if (is7702(config)) {
    if (!config.eoaAccount) {
      throw new Error('EIP-7702 accounts must have an EOA account')
    }
    return config.eoaAccount.address
  }
  const { factory, salt, hashedInitcode } = await getDeployArgs(config)
  const hash = keccak256(
    encodePacked(
      ['bytes1', 'address', 'bytes32', 'bytes'],
      ['0xff', factory, salt, hashedInitcode],
    ),
  )
  const address = slice(hash, 12, 32)
  return address
}

async function isDeployed(chain: Chain, config: RhinestoneAccountConfig) {
  const publicClient = createPublicClient({
    chain: chain,
    transport: http(),
  })
  const address = await getAddress(config)
  const code = await publicClient.getCode({
    address,
  })
  if (!code) {
    return false
  }
  if (code.startsWith('0xef0100') && code.length === 48) {
    // Defensive check to ensure there's no storage conflict; can be lifted in the future
    throw new Error('Existing EIP-7702 accounts are not yet supported')
  }
  return size(code) > 0
}

async function deploySource(
  deployer: Account,
  chain: Chain,
  config: RhinestoneAccountConfig,
) {
  if (is7702(config)) {
    return deploy7702Self(chain, config)
  } else {
    return deployStandaloneSelf(deployer, chain, config)
  }
}

async function deployTarget(chain: Chain, config: RhinestoneAccountConfig) {
  if (is7702(config)) {
    return deploy7702WithBundler(chain, config)
  }
  // No need to deploy manually outside of EIP-7702
}

async function getBundleInitCode(config: RhinestoneAccountConfig) {
  if (is7702(config)) {
    return undefined
  } else {
    const { factory, factoryData } = await getDeployArgs(config)
    if (!factory || !factoryData) {
      throw new Error('Factory args not available')
    }
    return encodePacked(['address', 'bytes'], [factory, factoryData])
  }
}

async function deploy7702Self(chain: Chain, config: RhinestoneAccountConfig) {
  if (!config.eoaAccount) {
    throw new Error('EIP-7702 accounts must have an EOA account')
  }

  const { implementation, initializationCallData } = await getDeployArgs(config)
  if (!initializationCallData) {
    throw new Error(
      `Initialization call data not available for ${config.account.type}`,
    )
  }

  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })
  const accountClient = createWalletClient({
    account: config.eoaAccount,
    chain,
    transport: http(),
  })

  const authorization = await accountClient.signAuthorization({
    contractAddress: implementation,
    executor: 'self',
  })

  const hash = await accountClient.sendTransaction({
    chain,
    authorizationList: [authorization],
    to: config.eoaAccount.address,
    data: initializationCallData,
  })
  await publicClient.waitForTransactionReceipt({ hash })
}

async function deployStandaloneSelf(
  deployer: Account,
  chain: Chain,
  config: RhinestoneAccountConfig,
) {
  const { factory, factoryData } = await getDeployArgs(config)
  const publicClient = createPublicClient({
    chain: chain,
    transport: http(),
  })
  const client = createWalletClient({
    account: deployer,
    chain: chain,
    transport: http(),
  })
  const tx = await client.sendTransaction({
    to: factory,
    data: factoryData,
  })
  await publicClient.waitForTransactionReceipt({ hash: tx })
}

async function deploy7702WithBundler(
  chain: Chain,
  config: RhinestoneAccountConfig,
) {
  if (!config.eoaAccount) {
    throw new Error('EIP-7702 accounts must have an EOA account')
  }

  const { implementation } = await getDeployArgs(config)

  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })
  const accountClient = createWalletClient({
    account: config.eoaAccount,
    chain,
    transport: http(),
  })
  const bundlerClient = getBundlerClient(config, publicClient)
  const fundingClient = createWalletClient({
    account: config.deployerAccount,
    chain,
    transport: http(),
  })

  const authorization = await accountClient.signAuthorization({
    contractAddress: implementation,
  })

  // Will be replaced by a bundler in the future
  const authTxHash = await fundingClient.sendTransaction({
    chain: publicClient.chain,
    authorizationList: [authorization],
  })
  await publicClient.waitForTransactionReceipt({ hash: authTxHash })

  // Init the account
  const smartAccount = await get7702SmartAccount(config, publicClient)
  const initCalls = await get7702InitCalls(config)
  const opHash = await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: initCalls,
  })

  await bundlerClient.waitForUserOperationReceipt({
    hash: opHash,
  })
}

async function get7702InitCalls(config: RhinestoneAccountConfig) {
  switch (config.account.type) {
    case 'safe': {
      return get7702SafeInitCalls()
    }
    case 'nexus': {
      return get7702NexusInitCalls(config)
    }
  }
}

async function get7702SmartAccount(
  config: RhinestoneAccountConfig,
  client: PublicClient,
) {
  if (!config.eoaAccount) {
    throw new Error('EIP-7702 accounts must have an EOA account')
  }

  switch (config.account.type) {
    case 'safe': {
      return get7702SafeAccount()
    }
    case 'nexus': {
      return get7702NexusAccount(config.eoaAccount, client)
    }
  }
}

function is7702(config: RhinestoneAccountConfig): boolean {
  return config.eoaAccount !== undefined
}

export {
  getDeployArgs,
  getBundleInitCode,
  getAddress,
  isDeployed,
  deploySource,
  deployTarget,
}
