import {
  type Chain,
  concat,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  type HashTypedDataParameters,
  type Hex,
  hashTypedData,
  type PublicClient,
  size,
  type TypedData,
  zeroAddress,
  zeroHash,
} from 'viem'
import {
  sendTransaction,
  sendTransactionInternal,
  sendUserOperationInternal,
  type TransactionResult,
  type UserOperationResult,
  waitForExecution,
} from '../execution'
import { getIntentExecutor, getSetup } from '../modules'
import type { Module } from '../modules/common'
import { getOwnerValidator } from '../modules/validators'
import { getSocialRecoveryValidator } from '../modules/validators/core'
import type {
  AccountProviderConfig,
  Call,
  OwnerSet,
  RhinestoneConfig,
  SignerSet,
} from '../types'
import {
  AccountConfigurationNotSupportedError,
  AccountError,
  Eip712DomainNotAvailableError,
  Eip7702AccountMustHaveEoaError,
  Eip7702NotSupportedForAccountError,
  EoaAccountMustHaveAccountError,
  EoaSigningMethodNotConfiguredError,
  EoaSigningNotSupportedError,
  ExistingEip7702AccountsNotSupportedError,
  FactoryArgsNotAvailableError,
  isAccountError,
  ModuleInstallationNotSupportedError,
  OwnersFieldRequiredError,
  SigningNotSupportedForAccountError,
  SmartSessionsNotEnabledError,
  WalletClientNoConnectedAccountError,
} from './error'
import {
  getAddress as getKernelAddress,
  getDeployArgs as getKernelDeployArgs,
  getEip712Domain as getKernelEip712Domain,
  getGuardianSmartAccount as getKernelGuardianSmartAccount,
  getInstallData as getKernelInstallData,
  getSmartAccount as getKernelSmartAccount,
  packSignature as packKernelSignature,
  wrapMessageHash as wrapKernelMessageHash,
} from './kernel'
import {
  getAddress as getNexusAddress,
  getDefaultValidatorAddress as getNexusDefaultValidatorAddress,
  getDeployArgs as getNexusDeployArgs,
  getEip712Domain as getNexusEip712Domain,
  getEip7702InitCall as getNexusEip7702InitCall,
  getGuardianSmartAccount as getNexusGuardianSmartAccount,
  getInstallData as getNexusInstallData,
  getSmartAccount as getNexusSmartAccount,
  packSignature as packNexusSignature,
  signEip7702InitData as signNexusEip7702InitData,
} from './nexus'
import {
  getAddress as getPassportAddress,
  getInstallData as getPassportInstallData,
  packSignature as packPassportSignature,
} from './passport'
import {
  getAddress as getSafeAddress,
  getDeployArgs as getSafeDeployArgs,
  getEip712Domain as getSafeEip712Domain,
  getGuardianSmartAccount as getSafeGuardianSmartAccount,
  getInstallData as getSafeInstallData,
  getSmartAccount as getSafeSmartAccount,
  getV0DeployArgs as getSafeV0DeployArgs,
  packSignature as packSafeSignature,
} from './safe'
import { convertOwnerSetToSignerSet } from './signing/common'
import { sign as signMessage } from './signing/message'
import { sign as signTypedData } from './signing/typedData'
import {
  getAddress as getStartaleAddress,
  getDeployArgs as getStartaleDeployArgs,
  getEip712Domain as getStartaleEip712Domain,
  getGuardianSmartAccount as getStartaleGuardianSmartAccount,
  getInstallData as getStartaleInstallData,
  getSmartAccount as getStartaleSmartAccount,
  packSignature as packStartaleSignature,
} from './startale'
import {
  createTransport,
  getBundlerClient,
  type ValidatorConfig,
} from './utils'

function getDeployArgs(config: RhinestoneConfig) {
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
    case 'startale': {
      return getStartaleDeployArgs(config)
    }
    case 'passport': {
      // Mocked data; will be overridden by the actual deploy args
      return {
        factory: zeroAddress,
        factoryData: zeroHash,
        salt: zeroHash,
        implementation: zeroAddress,
        initializationCallData: '0x',
        initData: '0x',
      }
    }
    case 'eoa': {
      throw new Error('EOA accounts do not have deploy args')
    }
  }
}

function getV0DeployArgs(config: RhinestoneConfig) {
  const account = getAccountProvider(config)
  switch (account.type) {
    case 'safe': {
      return getSafeV0DeployArgs(config)
    }
    default: {
      throw new Error(`Unsupported account type: ${account.type}`)
    }
  }
}

function getInitCode(config: RhinestoneConfig) {
  if (is7702(config)) {
    return undefined
  } else if (config.account?.type === 'eoa') {
    return undefined
  } else if (config.initData) {
    return config.initData
  } else {
    const deployArgs = getDeployArgs(config)
    if (!deployArgs) {
      throw new FactoryArgsNotAvailableError()
    }
    const { factory, factoryData } = deployArgs
    return {
      factory,
      factoryData,
    }
  }
}

function getV0InitCode(config: RhinestoneConfig) {
  if (is7702(config)) {
    return undefined
  } else if (config.account?.type === 'eoa') {
    return undefined
  } else if (config.initData) {
    return config.initData
  } else {
    const deployArgs = getV0DeployArgs(config)
    if (!deployArgs) {
      throw new FactoryArgsNotAvailableError()
    }
    const { factory, factoryData } = deployArgs
    return {
      factory,
      factoryData,
    }
  }
}

async function signEip7702InitData(config: RhinestoneConfig) {
  const eoa = config.eoa
  if (!eoa) {
    throw new Eip7702AccountMustHaveEoaError()
  }
  const account = getAccountProvider(config)
  switch (account.type) {
    case 'nexus': {
      return await signNexusEip7702InitData(config, eoa)
    }
    case 'eoa': {
      throw new Eip7702NotSupportedForAccountError(account.type)
    }
    case 'safe':
    case 'kernel':
    case 'startale': {
      throw new Eip7702NotSupportedForAccountError(account.type)
    }
    default: {
      throw new Eip7702NotSupportedForAccountError((account as any).type)
    }
  }
}

function getEip7702InitCall(config: RhinestoneConfig, signature: Hex) {
  const account = getAccountProvider(config)
  switch (account.type) {
    case 'nexus': {
      return getNexusEip7702InitCall(config, signature)
    }
    case 'safe':
    case 'kernel':
    case 'startale': {
      throw new Eip7702NotSupportedForAccountError(account.type)
    }
    default: {
      throw new Eip7702NotSupportedForAccountError((account as any).type)
    }
  }
}

function getEip712Domain(config: RhinestoneConfig, chain: Chain) {
  const account = getAccountProvider(config)
  switch (account.type) {
    case 'nexus': {
      return getNexusEip712Domain(config, chain)
    }
    case 'safe': {
      return getSafeEip712Domain(config, chain)
    }
    case 'kernel': {
      return getKernelEip712Domain(config, chain)
    }
    case 'startale': {
      return getStartaleEip712Domain(config, chain)
    }
    case 'eoa': {
      throw new Eip712DomainNotAvailableError(
        'EOA accounts do not have an EIP-712 domain',
      )
    }
    default: {
      throw new Eip712DomainNotAvailableError(
        `Account type ${(account as any).type} not yet supported`,
      )
    }
  }
}

function getModuleInstallationCalls(
  config: RhinestoneConfig,
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
      case 'startale': {
        return [getStartaleInstallData(module)]
      }
      case 'passport': {
        return [getPassportInstallData(module)]
      }
      case 'eoa': {
        throw new ModuleInstallationNotSupportedError(account.type)
      }
    }
  }

  const installData = getInstallData()
  return installData.map((data) => ({
    to: address,
    value: 0n,
    data,
  }))
}

function getModuleUninstallationCalls(
  config: RhinestoneConfig,
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
  return [{ to: address, data, value: 0n }]
}

function getAddress(config: RhinestoneConfig) {
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
    case 'startale': {
      return getStartaleAddress(config)
    }
    case 'passport': {
      return getPassportAddress(config)
    }
    case 'eoa': {
      if (!config.eoa) {
        throw new AccountError({
          message: 'EOA account must have an EOA configured',
        })
      }
      return config.eoa.address
    }
  }
}

function checkAddress(config: RhinestoneConfig) {
  if (!config.initData) {
    return true
  }
  return (
    config.initData.address.toLowerCase() === getAddress(config).toLowerCase()
  )
}

// Signs and packs a signature to be EIP-1271 compatible
async function getEip1271Signature(
  config: RhinestoneConfig,
  signers: SignerSet | undefined,
  chain: Chain,
  validator: ValidatorConfig,
  hash: Hex,
  transformSignature: (signature: Hex) => Hex = (signature) => signature,
): Promise<Hex> {
  if (config.account?.type === 'eoa') {
    throw new EoaSigningNotSupportedError('packed signatures')
  }

  signers = signers ?? convertOwnerSetToSignerSet(config.owners!)
  const signFn = (hash: Hex) =>
    signMessage(signers, chain, address, hash, false)
  const account = getAccountProvider(config)
  const address = getAddress(config)
  switch (account.type) {
    case 'safe': {
      const signature = await signFn(hash)
      return packSafeSignature(signature, validator, transformSignature)
    }
    case 'nexus': {
      const signature = await signFn(hash)
      const defaultValidatorAddress = getNexusDefaultValidatorAddress(
        account.version,
      )
      return packNexusSignature(
        signature,
        validator,
        transformSignature,
        defaultValidatorAddress,
      )
    }
    case 'passport': {
      const signature = await signFn(hash)
      return packPassportSignature(signature, validator, transformSignature)
    }
    case 'kernel': {
      const signature = await signFn(wrapKernelMessageHash(hash, address))
      return packKernelSignature(signature, validator, transformSignature)
    }
    case 'startale': {
      const signature = await signFn(hash)
      return packStartaleSignature(signature, validator, transformSignature)
    }
    default: {
      throw new Error(`Unsupported account type: ${(account as any).type}`)
    }
  }
}

// Signs and packs a signature to be EIP-1271 compatible
async function getTypedDataPackedSignature<
  typedData extends TypedData | Record<string, unknown> = TypedData,
  primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
>(
  config: RhinestoneConfig,
  signers: SignerSet | undefined,
  chain: Chain,
  validator: ValidatorConfig,
  parameters: HashTypedDataParameters<typedData, primaryType>,
  transformSignature: (signature: Hex) => Hex = (signature) => signature,
): Promise<Hex> {
  if (config.account?.type === 'eoa') {
    throw new EoaSigningNotSupportedError('packed signatures')
  }

  const address = getAddress(config)
  signers = signers ?? convertOwnerSetToSignerSet(config.owners!)
  const signFn = (
    parameters: HashTypedDataParameters<typedData, primaryType>,
  ) => signTypedData(signers, chain, address, parameters)
  const account = getAccountProvider(config)
  switch (account.type) {
    case 'safe': {
      const signature = await signFn(parameters)
      return packSafeSignature(signature, validator, transformSignature)
    }
    case 'nexus': {
      const signature = await signFn(parameters)
      const defaultValidatorAddress = getNexusDefaultValidatorAddress(
        account.version,
      )
      return packNexusSignature(
        signature,
        validator,
        transformSignature,
        defaultValidatorAddress,
      )
    }
    case 'passport': {
      const signature = await signFn(parameters)
      return packPassportSignature(signature, validator, transformSignature)
    }
    case 'kernel': {
      const address = getAddress(config)
      const signMessageFn = (hash: Hex) =>
        signMessage(signers, chain, address, hash, false)
      const signature = await signMessageFn(
        wrapKernelMessageHash(hashTypedData(parameters), address),
      )
      return packKernelSignature(signature, validator, transformSignature)
    }
    case 'startale': {
      const signature = await signFn(parameters)
      return packStartaleSignature(signature, validator, transformSignature)
    }
    default: {
      throw new Error(`Unsupported account type: ${(account as any).type}`)
    }
  }
}

async function isDeployed(config: RhinestoneConfig, chain: Chain) {
  const account = getAccountProvider(config)

  if (account.type === 'eoa') {
    return true
  }

  const publicClient = createPublicClient({
    chain: chain,
    transport: createTransport(chain, config.provider),
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
  config: RhinestoneConfig,
  chain: Chain,
  params?: {
    sponsored?: boolean
  },
): Promise<boolean> {
  const account = getAccountProvider(config)
  const deployArgs = getDeployArgs(config)
  if (!deployArgs) {
    throw new FactoryArgsNotAvailableError()
  }
  if (account.type === 'eoa') {
    return false
  }

  const deployed = await isDeployed(config, chain)
  if (deployed) {
    return false
  }
  const intentExecutorInstalled =
    'intentExecutorInstalled' in deployArgs
      ? deployArgs.intentExecutorInstalled
      : false
  // Use bundler directly when:
  // (account has initData and intent executor is not installed) || (custom bundler is configured)
  const useCustomBundler = config.bundler?.type === 'custom'
  const asUserOp =
    (config.initData && !intentExecutorInstalled) || useCustomBundler
  if (asUserOp) {
    await deployWithBundler(chain, config)
  } else {
    await deployWithIntent(chain, config, params?.sponsored ?? false)
  }
  return true
}

// Installs the missing modules
// Checks if the provided modules are already installed
// Useful for existing (already deployed) accounts
async function setup(config: RhinestoneConfig, chain: Chain): Promise<boolean> {
  const account = getAccountProvider(config)

  if (account.type === 'eoa') {
    return false
  }

  const modules = getSetup(config)
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, config.provider),
  })
  const address = getAddress(config)
  const allModules = [
    ...modules.validators,
    ...modules.executors,
    ...modules.fallbacks,
    ...modules.hooks,
  ]
  // Check if the modules are already installed
  const installedResults = await publicClient.multicall({
    contracts: allModules.map((module) => ({
      address: address,
      abi: [
        {
          type: 'function',
          name: 'isModuleInstalled',
          inputs: [
            { type: 'uint256', name: 'moduleTypeId' },
            { type: 'address', name: 'module' },
            { type: 'bytes', name: 'additionalContext' },
          ],
          outputs: [{ type: 'bool', name: 'isInstalled' }],
          stateMutability: 'view',
        },
      ] as const,
      functionName: 'isModuleInstalled',
      args: [module.type, module.address, module.additionalContext],
    })),
  })
  const isInstalled = installedResults.map((result) => result.result)
  const modulesToInstall = allModules.filter((_, index) => !isInstalled[index])
  if (modulesToInstall.length === 0) {
    // Nothing to install
    return false
  }
  const calls = []
  for (const module of modulesToInstall) {
    calls.push(...getModuleInstallationCalls(config, module))
  }
  // Select the transaction infra layer based on the intent executor status
  const intentExecutor = getIntentExecutor(config)
  const hasIntentExecutor = modulesToInstall.every(
    (module) => module.address !== intentExecutor.address,
  )
  let result: TransactionResult | UserOperationResult
  if (hasIntentExecutor) {
    result = await sendTransactionInternal(config, [chain], chain, {
      callInputs: calls,
    })
  } else {
    result = await sendUserOperationInternal(config, chain, calls)
  }
  await waitForExecution(config, result, true)
  return true
}

async function deployWithIntent(
  chain: Chain,
  config: RhinestoneConfig,
  sponsored: boolean,
) {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, config.provider),
  })
  const address = getAddress(config)
  const code = await publicClient.getCode({ address })
  if (code) {
    // Already deployed
    return
  }
  const result = await sendTransaction(config, {
    sourceChains: [chain],
    targetChain: chain,
    calls: [],
    sponsored,
  })
  await waitForExecution(config, result, true)
}

async function deployWithBundler(chain: Chain, config: RhinestoneConfig) {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, config.provider),
  })
  const bundlerClient = getBundlerClient(config, publicClient)
  const smartAccount = await getSmartAccount(config, publicClient, chain)
  const deployArgs = getDeployArgs(config)
  if (!deployArgs) {
    throw new FactoryArgsNotAvailableError()
  }
  const { factory, factoryData } = deployArgs
  const opHash = await bundlerClient.sendUserOperation({
    account: smartAccount,
    factory,
    factoryData,
    calls: [
      {
        to: zeroAddress,
        value: 0n,
        data: '0x',
      },
    ],
  })
  await bundlerClient.waitForUserOperationReceipt({
    hash: opHash,
  })
}

async function toErc6492Signature(
  config: RhinestoneConfig,
  signature: Hex,
  chain: Chain,
): Promise<Hex> {
  const deployed = await isDeployed(config, chain)
  if (deployed) {
    return signature
  }
  // Account is not deployed, use ERC-6492
  const initCode = getInitCode(config)
  if (!initCode) {
    throw new FactoryArgsNotAvailableError()
  }
  const deployArgs = getDeployArgs(config)
  if (!deployArgs) {
    throw new FactoryArgsNotAvailableError()
  }
  const { factory, factoryData } = deployArgs
  const magicBytes =
    '0x6492649264926492649264926492649264926492649264926492649264926492'
  return concat([
    encodeAbiParameters(
      [
        { name: 'create2Factory', type: 'address' },
        { name: 'factoryCalldata', type: 'bytes' },
        { name: 'originalERC1271Signature', type: 'bytes' },
      ],
      [factory, factoryData, signature],
    ),
    magicBytes,
  ])
}

async function getSmartAccount(
  config: RhinestoneConfig,
  client: PublicClient,
  chain: Chain,
) {
  // EOA accounts don't need smart account functionality
  if (config.account?.type === 'eoa') {
    throw new Error('getSmartAccount is not supported for EOA accounts')
  }

  if (!config.owners) {
    throw new OwnersFieldRequiredError()
  }

  const account = getAccountProvider(config)
  const address = getAddress(config)
  const ownerValidator = getOwnerValidator(config)
  const signers: SignerSet = convertOwnerSetToSignerSet(config.owners)
  const signFn = (hash: Hex) => signMessage(signers, chain, address, hash, true)
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
      const defaultValidatorAddress = getNexusDefaultValidatorAddress(
        account.version,
      )
      return getNexusSmartAccount(
        client,
        address,
        config.owners,
        ownerValidator.address,
        signFn,
        defaultValidatorAddress,
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
    case 'startale': {
      return getStartaleSmartAccount(
        client,
        address,
        config.owners,
        ownerValidator.address,
        signFn,
      )
    }
  }
}

async function getGuardianSmartAccount(
  config: RhinestoneConfig,
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
  const signers: SignerSet = {
    type: 'guardians',
    guardians: accounts,
  }
  const signFn = (hash: Hex) => signMessage(signers, chain, address, hash, true)

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
      const defaultValidatorAddress = getNexusDefaultValidatorAddress(
        account.version,
      )
      return getNexusGuardianSmartAccount(
        client,
        address,
        guardians,
        socialRecoveryValidator.address,
        signFn,
        defaultValidatorAddress,
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
    case 'startale': {
      return getStartaleGuardianSmartAccount(
        client,
        address,
        guardians,
        socialRecoveryValidator.address,
        signFn,
      )
    }
  }
}

function is7702(config: RhinestoneConfig): boolean {
  const account = getAccountProvider(config)
  return account.type !== 'eoa' && config.eoa !== undefined
}

function getAccountProvider(config: RhinestoneConfig): AccountProviderConfig {
  if (config.account) {
    return config.account
  }
  return {
    type: 'nexus',
  }
}

export {
  getEip712Domain,
  getModuleInstallationCalls,
  getModuleUninstallationCalls,
  getAddress,
  checkAddress,
  getAccountProvider,
  getInitCode,
  getV0InitCode,
  signEip7702InitData,
  getEip7702InitCall,
  is7702,
  isDeployed,
  deploy,
  setup,
  toErc6492Signature,
  getSmartAccount,
  getGuardianSmartAccount,
  getPackedSignature,
  getTypedDataPackedSignature,
  // Errors
  isAccountError,
  AccountError,
  AccountConfigurationNotSupportedError,
  Eip712DomainNotAvailableError,
  Eip7702AccountMustHaveEoaError,
  Eip7702NotSupportedForAccountError,
  EoaAccountMustHaveAccountError,
  EoaSigningMethodNotConfiguredError,
  EoaSigningNotSupportedError,
  ExistingEip7702AccountsNotSupportedError,
  FactoryArgsNotAvailableError,
  ModuleInstallationNotSupportedError,
  OwnersFieldRequiredError,
  SigningNotSupportedForAccountError,
  SmartSessionsNotEnabledError,
  WalletClientNoConnectedAccountError,
}
