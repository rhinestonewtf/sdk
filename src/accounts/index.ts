import {
  type Account,
  type Chain,
  concat,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  encodePacked,
  type Hex,
  http,
  type PublicClient,
  size,
  zeroHash,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import { enableSmartSession } from '../execution/smart-session'
import {
  getWebauthnValidatorSignature,
  isRip7212SupportedNetwork,
} from '../modules'
import { Module } from '../modules/common'
import {
  getOwnerValidator,
  getSmartSessionValidator,
} from '../modules/validators'
import { getSocialRecoveryValidator } from '../modules/validators/core'
import type {
  AccountProviderConfig,
  Call,
  OwnerSet,
  RhinestoneAccountConfig,
  Session,
} from '../types'
import {
  get7702SmartAccount as get7702KernelAccount,
  get7702InitCalls as get7702KernelInitCalls,
  getAddress as getKernelAddress,
  getDeployArgs as getKernelDeployArgs,
  getGuardianSmartAccount as getKernelGuardianSmartAccount,
  getInstallData as getKernelInstallData,
  getPackedSignature as getKernelPackedSignature,
  getSessionSmartAccount as getKernelSessionSmartAccount,
  getSmartAccount as getKernelSmartAccount,
} from './kernel'
import {
  get7702SmartAccount as get7702NexusAccount,
  get7702InitCalls as get7702NexusInitCalls,
  getAddress as getNexusAddress,
  getDeployArgs as getNexusDeployArgs,
  getGuardianSmartAccount as getNexusGuardianSmartAccount,
  getInstallData as getNexusInstallData,
  getPackedSignature as getNexusPackedSignature,
  getSessionSmartAccount as getNexusSessionSmartAccount,
  getSmartAccount as getNexusSmartAccount,
} from './nexus'
import {
  get7702SmartAccount as get7702SafeAccount,
  get7702InitCalls as get7702SafeInitCalls,
  getAddress as getSafeAddress,
  getDeployArgs as getSafeDeployArgs,
  getGuardianSmartAccount as getSafeGuardianSmartAccount,
  getInstallData as getSafeInstallData,
  getPackedSignature as getSafePackedSignature,
  getSessionSmartAccount as getSafeSessionSmartAccount,
  getSmartAccount as getSafeSmartAccount,
} from './safe'
import { getBundlerClient, ValidatorConfig } from './utils'

function getDeployArgs(config: RhinestoneAccountConfig) {
  const account = getAccount(config)
  switch (account.type) {
    case 'safe': {
      return getSafeDeployArgs(config)
    }
    case 'nexus': {
      return getNexusDeployArgs(config)
    }
    case 'kernel': {
      return getKernelDeployArgs(config)
    }
  }
}

function getModuleInstallationCalls(
  config: RhinestoneAccountConfig,
  module: Module,
): Call[] {
  const address = getAddress(config)

  function getInstallData() {
    const account = getAccount(config)
    switch (account.type) {
      case 'safe': {
        return [getSafeInstallData(module)]
      }
      case 'nexus': {
        return [getNexusInstallData(module)]
      }
      case 'kernel': {
        return getKernelInstallData(module)
      }
    }
  }

  const installData = getInstallData()
  return installData.map((data) => ({
    to: address,
    data,
  }))
}

function getModuleUninstallationCalls(
  config: RhinestoneAccountConfig,
  module: Module,
): Call[] {
  const address = getAddress(config)
  const data = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'uninstallModule',
        inputs: [
          {
            type: 'uint256',
            name: 'moduleTypeId',
          },
          {
            type: 'address',
            name: 'module',
          },
          {
            type: 'bytes',
            name: 'deInitData',
          },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'uninstallModule',
    args: [module.type, module.address, module.deInitData],
  })
  return [{ to: address, data }]
}

function getAddress(config: RhinestoneAccountConfig) {
  if (is7702(config)) {
    if (!config.eoa) {
      throw new Error('EIP-7702 accounts must have an EOA account')
    }
    return config.eoa.address
  }
  const account = getAccount(config)
  switch (account.type) {
    case 'safe': {
      return getSafeAddress(config)
    }
    case 'nexus': {
      return getNexusAddress(config)
    }
    case 'kernel': {
      return getKernelAddress(config)
    }
  }
}

// Signs and packs a signature to be EIP-1271 compatibleAdd commentMore actions
async function getPackedSignature(
  config: RhinestoneAccountConfig,
  owners: OwnerSet,
  chain: Chain,
  validator: ValidatorConfig,
  hash: Hex,
  transformSignature: (signature: Hex) => Hex = (signature) => signature,
) {
  const signFn = (hash: Hex) => sign(owners, chain, hash)
  const account = getAccount(config)
  const address = getAddress(config)
  switch (account.type) {
    case 'safe': {
      return getSafePackedSignature(signFn, hash, validator, transformSignature)
    }
    case 'nexus': {
      return getNexusPackedSignature(
        signFn,
        hash,
        validator,
        transformSignature,
      )
    }
    case 'kernel': {
      return getKernelPackedSignature(
        signFn,
        hash,
        validator,
        address,
        transformSignature,
      )
    }
  }
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

async function deploy(
  config: RhinestoneAccountConfig,
  chain: Chain,
  session?: Session,
) {
  await deploySource(chain, config)
  if (session) {
    await enableSmartSession(chain, config, session)
  }
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
    case 'kernel': {
      return getKernelSmartAccount(
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
    case 'kernel': {
      return getKernelSessionSmartAccount(
        client,
        address,
        session,
        smartSessionValidator.address,
        signFn,
      )
    }
  }
}

async function getGuardianSmartAccount(
  config: RhinestoneAccountConfig,
  client: PublicClient,
  chain: Chain,
  guardians: OwnerSet,
) {
  const address = getAddress(config)
  const accounts = guardians.type === 'ecdsa' ? guardians.accounts : []
  const socialRecoveryValidator = getSocialRecoveryValidator(accounts)
  if (!socialRecoveryValidator) {
    throw new Error('Social recovery is not enabled for this account')
  }
  const signFn = (hash: Hex) => sign(guardians, chain, hash)

  const account = getAccount(config)
  switch (account.type) {
    case 'safe': {
      return getSafeGuardianSmartAccount(
        client,
        address,
        guardians,
        socialRecoveryValidator.address,
        signFn,
      )
    }
    case 'nexus': {
      return getNexusGuardianSmartAccount(
        client,
        address,
        guardians,
        socialRecoveryValidator.address,
        signFn,
      )
    }
    case 'kernel': {
      return getKernelGuardianSmartAccount(
        client,
        address,
        guardians,
        socialRecoveryValidator.address,
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
    case 'kernel': {
      return get7702KernelAccount()
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
    case 'kernel': {
      return get7702KernelInitCalls()
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
  getModuleInstallationCalls,
  getModuleUninstallationCalls,
  getDeployArgs,
  getBundleInitCode,
  getAddress,
  isDeployed,
  deploy,
  deploySource,
  deployTarget,
  getSmartAccount,
  getSmartSessionSmartAccount,
  getGuardianSmartAccount,
  getPackedSignature,
  sign,
}
