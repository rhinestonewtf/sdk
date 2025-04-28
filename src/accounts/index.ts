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
  Hex,
  concat,
} from 'viem'
import { WebAuthnAccount } from 'viem/account-abstraction'

import {
  AccountProviderConfig,
  OwnerSet,
  RhinestoneAccountConfig,
  Session,
} from '../types'
import {
  getWebauthnValidatorSignature,
  isRip7212SupportedNetwork,
} from '../modules'
import {
  getOwnerValidator,
  getSmartSessionValidator,
} from '../modules/validators'

import {
  getDeployArgs as getSafeDeployArgs,
  getSmartAccount as getSafeSmartAccount,
  get7702InitCalls as get7702SafeInitCalls,
  get7702SmartAccount as get7702SafeAccount,
  getSessionSmartAccount as getSafeSessionSmartAccount,
} from './safe'
import {
  getDeployArgs as getNexusDeployArgs,
  getSmartAccount as getNexusSmartAccount,
  get7702InitCalls as get7702NexusInitCalls,
  get7702SmartAccount as get7702NexusAccount,
  getSessionSmartAccount as getNexusSessionSmartAccount,
} from './nexus'
import { getBundlerClient } from './utils'

async function getDeployArgs(config: RhinestoneAccountConfig) {
  const account = getAccount(config)
  switch (account.type) {
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
    if (!config.eoa) {
      throw new Error('EIP-7702 accounts must have an EOA account')
    }
    return config.eoa.address
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

async function deploySource(chain: Chain, config: RhinestoneAccountConfig) {
  if (is7702(config)) {
    return deploy7702Self(chain, config)
  } else {
    return deployStandaloneSelf(chain, config)
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
  if (!config.eoa) {
    throw new Error('EIP-7702 accounts must have an EOA account')
  }

  const account = getAccount(config)
  const { implementation, initializationCallData } = await getDeployArgs(config)
  if (!initializationCallData) {
    throw new Error(
      `Initialization call data not available for ${account.type}`,
    )
  }

  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })
  const accountClient = createWalletClient({
    account: config.eoa,
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
    to: config.eoa.address,
    data: initializationCallData,
  })
  await publicClient.waitForTransactionReceipt({ hash })
}

async function deployStandaloneSelf(
  chain: Chain,
  config: RhinestoneAccountConfig,
) {
  const deployer = config.deployerAccount
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
  if (!config.eoa) {
    throw new Error('EIP-7702 accounts must have an EOA account')
  }

  const { implementation } = await getDeployArgs(config)

  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })
  const accountClient = createWalletClient({
    account: config.eoa,
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

async function getSmartAccount(
  config: RhinestoneAccountConfig,
  client: PublicClient,
  chain: Chain,
) {
  const account = getAccount(config)
  const address = await getAddress(config)
  const ownerValidator = getOwnerValidator(config)
  const signFn = (hash: Hex) => sign(config.owners, chain, hash)
  switch (account.type) {
    case 'safe': {
      return getSafeSmartAccount(
        client,
        address,
        config.owners,
        ownerValidator.address,
        signFn,
      )
    }
    case 'nexus': {
      return getNexusSmartAccount(
        client,
        address,
        config.owners,
        ownerValidator.address,
        signFn,
      )
    }
  }
}

async function getSmartSessionSmartAccount(
  config: RhinestoneAccountConfig,
  client: PublicClient,
  chain: Chain,
  session: Session,
) {
  const address = await getAddress(config)
  const smartSessionValidator = getSmartSessionValidator(config)
  if (!smartSessionValidator) {
    throw new Error('Smart sessions are not enabled for this account')
  }
  const signFn = (hash: Hex) => sign(session.owners, chain, hash)

  const account = getAccount(config)
  switch (account.type) {
    case 'safe': {
      return getSafeSessionSmartAccount(
        client,
        address,
        session,
        smartSessionValidator.address,
        signFn,
      )
    }
    case 'nexus': {
      return getNexusSessionSmartAccount(
        client,
        address,
        session,
        smartSessionValidator.address,
        signFn,
      )
    }
  }
}

async function sign(validators: OwnerSet, chain: Chain, hash: Hex) {
  switch (validators.type) {
    case 'ecdsa': {
      const signatures = await Promise.all(
        validators.accounts.map((account) => signEcdsa(account, hash)),
      )
      return concat(signatures)
    }
    case 'passkey': {
      return await signPasskey(validators.account, chain, hash)
    }
  }
}

async function signEcdsa(account: Account, hash: Hex) {
  if (!account.signMessage) {
    throw new Error('Signing not supported for the account')
  }
  return await account.signMessage({ message: { raw: hash } })
}

async function signPasskey(account: WebAuthnAccount, chain: Chain, hash: Hex) {
  const { webauthn, signature } = await account.sign({ hash })
  const usePrecompiled = isRip7212SupportedNetwork(chain)
  const encodedSignature = getWebauthnValidatorSignature({
    webauthn,
    signature,
    usePrecompiled,
  })
  return encodedSignature
}

async function get7702SmartAccount(
  config: RhinestoneAccountConfig,
  client: PublicClient,
) {
  if (!config.eoa) {
    throw new Error('EIP-7702 accounts must have an EOA account')
  }

  const account = getAccount(config)
  switch (account.type) {
    case 'safe': {
      return get7702SafeAccount()
    }
    case 'nexus': {
      return get7702NexusAccount(config.eoa, client)
    }
  }
}

async function get7702InitCalls(config: RhinestoneAccountConfig) {
  const account = getAccount(config)
  switch (account.type) {
    case 'safe': {
      return get7702SafeInitCalls()
    }
    case 'nexus': {
      return get7702NexusInitCalls(config)
    }
  }
}

function is7702(config: RhinestoneAccountConfig): boolean {
  return config.eoa !== undefined
}

function getAccount(config: RhinestoneAccountConfig): AccountProviderConfig {
  if (config.account) {
    return config.account
  }
  return {
    type: 'nexus',
  }
}

export {
  getDeployArgs,
  getBundleInitCode,
  getAddress,
  isDeployed,
  deploySource,
  deployTarget,
  getSmartAccount,
  getSmartSessionSmartAccount,
  sign,
}
