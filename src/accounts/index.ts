import {
  type Account,
  type Chain,
  concat,
  createPublicClient,
  createWalletClient,
  encodePacked,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  size,
  slice,
  zeroHash,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import {
  getWebauthnValidatorSignature,
  isRip7212SupportedNetwork,
} from '../modules'
import {
  getOwnerValidator,
  getSmartSessionValidator,
} from '../modules/validators'
import type {
  AccountProviderConfig,
  OwnerSet,
  RhinestoneAccountConfig,
  Session,
} from '../types'
import {
  get7702SmartAccount as get7702NexusAccount,
  get7702InitCalls as get7702NexusInitCalls,
  getDeployArgs as getNexusDeployArgs,
  getSessionSmartAccount as getNexusSessionSmartAccount,
  getSmartAccount as getNexusSmartAccount,
} from './nexus'
import {
  get7702SmartAccount as get7702SafeAccount,
  get7702InitCalls as get7702SafeInitCalls,
  getDeployArgs as getSafeDeployArgs,
  getSessionSmartAccount as getSafeSessionSmartAccount,
  getSmartAccount as getSafeSmartAccount,
} from './safe'
import { getBundlerClient } from './utils'

function getDeployArgs(config: RhinestoneAccountConfig) {
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

function getAddress(config: RhinestoneAccountConfig) {
  if (is7702(config)) {
    if (!config.eoa) {
      throw new Error('EIP-7702 accounts must have an EOA account')
    }
    return config.eoa.address
  }
  const { factory, salt, hashedInitcode } = getDeployArgs(config)
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
  const address = getAddress(config)
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
    return deployStandalone(chain, config)
  }
}

async function deployTarget(
  chain: Chain,
  config: RhinestoneAccountConfig,
  asUserOp: boolean,
) {
  if (is7702(config)) {
    return deploy7702WithBundler(chain, config)
  }
  if (asUserOp) {
    return deployStandalone(chain, config)
  }
  // No need to deploy manually for the intent flow
}

async function deployStandalone(chain: Chain, config: RhinestoneAccountConfig) {
  const deployer = config.deployerAccount
  if (deployer) {
    return deployStandaloneWithEoa(chain, config, deployer)
  }
  return deployStandaloneWithBundler(chain, config)
}

function getBundleInitCode(config: RhinestoneAccountConfig) {
  if (is7702(config)) {
    return undefined
  } else {
    const { factory, factoryData } = getDeployArgs(config)
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
  const { implementation, initializationCallData } = getDeployArgs(config)
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

async function deployStandaloneWithEoa(
  chain: Chain,
  config: RhinestoneAccountConfig,
  deployer: Account,
) {
  const { factory, factoryData } = getDeployArgs(config)
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

async function deployStandaloneWithBundler(
  chain: Chain,
  config: RhinestoneAccountConfig,
) {
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })
  const bundlerClient = getBundlerClient(config, publicClient)
  const smartAccount = await getSmartAccount(config, publicClient, chain)
  const { factory, factoryData } = getDeployArgs(config)
  const opHash = await bundlerClient.sendUserOperation({
    account: smartAccount,
    factory,
    factoryData,
    calls: [
      {
        to: zeroHash,
        value: 0n,
        data: '0x',
      },
    ],
  })
  await bundlerClient.waitForUserOperationReceipt({
    hash: opHash,
  })
}

async function deploy7702WithBundler(
  chain: Chain,
  config: RhinestoneAccountConfig,
) {
  if (!config.eoa) {
    throw new Error('EIP-7702 accounts must have an EOA account')
  }

  const { implementation } = getDeployArgs(config)

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

  const authorization = await accountClient.signAuthorization({
    contractAddress: implementation,
  })

  // Init the account
  const smartAccount = await get7702SmartAccount(config, publicClient)
  const initCalls = await get7702InitCalls(config)
  const opHash = await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: initCalls,
    authorization,
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
  const address = getAddress(config)
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
  const address = getAddress(config)
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
