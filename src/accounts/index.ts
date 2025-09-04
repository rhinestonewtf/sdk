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
  type Transport,
  zeroHash,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import { enableSmartSession } from '../execution/smart-session'
import {
  getWebauthnValidatorSignature,
  isRip7212SupportedNetwork,
} from '../modules'
import type { Module } from '../modules/common'
import {
  getOwnerValidator,
  getSmartSessionValidator,
} from '../modules/validators'
import { getSocialRecoveryValidator } from '../modules/validators/core'
import type { EnableSessionData } from '../modules/validators/smart-sessions'
import type {
  AccountProviderConfig,
  Call,
  OwnerSet,
  RhinestoneAccountConfig,
  Session,
} from '../types'
import {
  get7702InitCalls as getCustom7702InitCalls,
  getAddress as getCustomAddress,
  getDeployArgs as getCustomDeployArgs,
  getInstallData as getCustomInstallData,
  getPackedSignature as getCustomPackedSignature,
  getSessionSmartAccount as getCustomSessionSmartAccount,
  getSmartAccount as getCustomSmartAccount,
} from './custom'
import {
  AccountError,
  Eip7702AccountMustHaveEoaError,
  Eip7702NotSupportedForAccountError,
  ExistingEip7702AccountsNotSupportedError,
  FactoryArgsNotAvailableError,
  isAccountError,
  SigningNotSupportedForAccountError,
  SignMessageNotSupportedByAccountError,
  SmartSessionsNotEnabledError,
} from './error'
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
import { getBundlerClient, type ValidatorConfig } from './utils'

function getDeployArgs(config: RhinestoneAccountConfig) {
  const account = getAccountProvider(config)
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
    case 'custom': {
      return getCustomDeployArgs(config)
    }
  }
}

function getModuleInstallationCalls(
  config: RhinestoneAccountConfig,
  module: Module,
): Call[] {
  const address = getAddress(config)

  function getInstallData() {
    const account = getAccountProvider(config)
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
      case 'custom': {
        return getCustomInstallData(config, module)
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
      throw new Eip7702AccountMustHaveEoaError()
    }
    return config.eoa.address
  }
  const account = getAccountProvider(config)
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
    case 'custom': {
      return getCustomAddress(config)
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
  const account = getAccountProvider(config)
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
    case 'custom': {
      return getCustomPackedSignature(
        config,
        signFn,
        hash,
        validator,
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
    throw new ExistingEip7702AccountsNotSupportedError()
  }
  return size(code) > 0
}

async function deploy(
  config: RhinestoneAccountConfig,
  chain: Chain,
  session?: Session,
) {
  const deployed = await isDeployed(chain, config)
  if (deployed) {
    return
  }
  await deploySource(chain, config)
  if (session) {
    await enableSmartSession(chain, config, session)
  }
}

async function deploySource(chain: Chain, config: RhinestoneAccountConfig) {
  if (is7702(config)) {
    return deploy7702WithBundler(chain, config)
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
      throw new FactoryArgsNotAvailableError()
    }
    return encodePacked(['address', 'bytes'], [factory, factoryData])
  }
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
    throw new Eip7702AccountMustHaveEoaError()
  }

  const { implementation } = getDeployArgs(config)

  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })
  const customTransport =
    'transport' in config.eoa ? config.eoa.transport : undefined
  const accountClient = createWalletClient({
    account: config.eoa,
    chain,
    transport: customTransport ? (customTransport as Transport) : http(),
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
  const account = getAccountProvider(config)
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
    case 'custom': {
      return getCustomSmartAccount(
        config,
        client,
        address,
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
  enableData: EnableSessionData | null,
) {
  const address = getAddress(config)
  const smartSessionValidator = getSmartSessionValidator(config)
  if (!smartSessionValidator) {
    throw new SmartSessionsNotEnabledError()
  }
  const signFn = (hash: Hex) => sign(session.owners, chain, hash)

  const account = getAccountProvider(config)
  switch (account.type) {
    case 'safe': {
      return getSafeSessionSmartAccount(
        client,
        address,
        session,
        smartSessionValidator.address,
        enableData,
        signFn,
      )
    }
    case 'nexus': {
      return getNexusSessionSmartAccount(
        client,
        address,
        session,
        smartSessionValidator.address,
        enableData,
        signFn,
      )
    }
    case 'kernel': {
      return getKernelSessionSmartAccount(
        client,
        address,
        session,
        smartSessionValidator.address,
        enableData,
        signFn,
      )
    }
    case 'custom': {
      return getCustomSessionSmartAccount(
        config,
        client,
        address,
        session,
        smartSessionValidator.address,
        enableData,
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
    throw new Error('Social recovery is not available')
  }
  const signFn = (hash: Hex) => sign(guardians, chain, hash)

  const account = getAccountProvider(config)
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
    case 'custom': {
      throw new Error('Custom account does not support guardians')
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
    throw new SigningNotSupportedForAccountError()
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
    throw new Eip7702AccountMustHaveEoaError()
  }

  const account = getAccountProvider(config)
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
  const account = getAccountProvider(config)
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
    case 'custom': {
      return getCustom7702InitCalls(config)
    }
  }
}

function is7702(config: RhinestoneAccountConfig): boolean {
  return config.eoa !== undefined
}

function getAccountProvider(
  config: RhinestoneAccountConfig,
): AccountProviderConfig {
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
  getAccountProvider,
  isDeployed,
  deploy,
  deploySource,
  deployTarget,
  getSmartAccount,
  getSmartSessionSmartAccount,
  getGuardianSmartAccount,
  getPackedSignature,
  sign,
  // Errors
  isAccountError,
  AccountError,
  Eip7702AccountMustHaveEoaError,
  ExistingEip7702AccountsNotSupportedError,
  FactoryArgsNotAvailableError,
  SmartSessionsNotEnabledError,
  SigningNotSupportedForAccountError,
  SignMessageNotSupportedByAccountError,
  Eip7702NotSupportedForAccountError,
}
