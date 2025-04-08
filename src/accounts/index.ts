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
} from 'viem'

import { RhinestoneAccountConfig } from '../types'

import { getDeployArgs as getSafeDeployArgs } from './safe'
import { getDeployArgs as getNexusDeployArgs } from './nexus'

async function getAddress(config: RhinestoneAccountConfig) {
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
    throw new Error('EIP-7702 accounts are not yet supported')
  }
  return size(code) > 0
}

async function deploy(
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

export { getAddress, isDeployed, getDeployArgs, deploy }
