import {
  createPublicClient,
  encodeFunctionData,
  type HashTypedDataParameters,
  type Hex,
  hashTypedData,
  type PublicClient,
  size,
  type TypedData,
  zeroAddress,
} from 'viem'
import { sendTransaction, waitForExecution } from '../execution'
import { ChainNotSupportedError } from '../execution/error'
import { enableSmartSession } from '../execution/smart-session'
import type { Module } from '../modules/common'
import {
  getOwnerValidator,
  getSmartSessionValidator,
} from '../modules/validators'
import { getSocialRecoveryValidator } from '../modules/validators/core'
import type { EnableSessionData } from '../modules/validators/smart-sessions'
import { getChainById } from '../orchestrator/registry'
import type {
  AccountProviderConfig,
  Call,
  OwnerSet,
  RhinestoneAccountConfig,
  Session,
  SignerSet,
} from '../types'
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
  getAddress as getKernelAddress,
  getDeployArgs as getKernelDeployArgs,
  getGuardianSmartAccount as getKernelGuardianSmartAccount,
  getInstallData as getKernelInstallData,
  getSessionSmartAccount as getKernelSessionSmartAccount,
  getSmartAccount as getKernelSmartAccount,
  packSignature as packKernelSignature,
  wrapMessageHash as wrapKernelMessageHash,
} from './kernel'
import {
  getAddress as getNexusAddress,
  getDeployArgs as getNexusDeployArgs,
  getEip7702InitCall as getNexusEip7702InitCall,
  getGuardianSmartAccount as getNexusGuardianSmartAccount,
  getInstallData as getNexusInstallData,
  getSessionSmartAccount as getNexusSessionSmartAccount,
  getSmartAccount as getNexusSmartAccount,
  packSignature as packNexusSignature,
  signEip7702InitData as signNexusEip7702InitData,
} from './nexus'
import {
  getAddress as getSafeAddress,
  getDeployArgs as getSafeDeployArgs,
  getGuardianSmartAccount as getSafeGuardianSmartAccount,
  getInstallData as getSafeInstallData,
  getSessionSmartAccount as getSafeSessionSmartAccount,
  getSmartAccount as getSafeSmartAccount,
  packSignature as packSafeSignature,
} from './safe'
import { convertOwnerSetToSignerSet } from './signing/common'
import { sign as signMessage } from './signing/message'
import { sign as signTypedData } from './signing/typedData'
import {
  getAddress as getStartaleAddress,
  getDeployArgs as getStartaleDeployArgs,
  getGuardianSmartAccount as getStartaleGuardianSmartAccount,
  getInstallData as getStartaleInstallData,
  getSessionSmartAccount as getStartaleSessionSmartAccount,
  getSmartAccount as getStartaleSmartAccount,
  packSignature as packStartaleSignature,
} from './startale'
import { createTransport, type ValidatorConfig } from './utils'

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
    case 'startale': {
      return getStartaleDeployArgs(config)
    }
  }
}

function getInitCode(config: RhinestoneAccountConfig) {
  if (is7702(config)) {
    return undefined
  } else {
    const { factory, factoryData } = getDeployArgs(config)
    if (!factory || !factoryData) {
      throw new FactoryArgsNotAvailableError()
    }
    return {
      factory,
      factoryData,
    }
  }
}

async function signEip7702InitData(config: RhinestoneAccountConfig) {
  const eoa = config.eoa
  if (!eoa) {
    throw new Eip7702AccountMustHaveEoaError()
  }
  const account = getAccountProvider(config)
  switch (account.type) {
    case 'nexus': {
      return await signNexusEip7702InitData(config, eoa)
    }
    case 'safe':
    case 'kernel':
    case 'startale': {
      throw new Eip7702NotSupportedForAccountError(account.type)
    }
  }
}

async function getEip7702InitCall(
  config: RhinestoneAccountConfig,
  signature: Hex,
) {
  const account = getAccountProvider(config)
  switch (account.type) {
    case 'nexus': {
      return await getNexusEip7702InitCall(config, signature)
    }
    case 'safe':
    case 'kernel':
    case 'startale': {
      throw new Eip7702NotSupportedForAccountError(account.type)
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
      case 'startale': {
        return [getStartaleInstallData(module)]
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
  return [{ to: address, data, value: 0n }]
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
    case 'startale': {
      return getStartaleAddress(config)
    }
  }
}

// Signs and packs a signature to be EIP-1271 compatible
async function getPackedSignature(
  config: RhinestoneAccountConfig,
  signers: SignerSet | undefined,
  chainId: number,
  validator: ValidatorConfig,
  hash: Hex,
  transformSignature: (signature: Hex) => Hex = (signature) => signature,
) {
  signers = signers ?? convertOwnerSetToSignerSet(config.owners)
  const signFn = (hash: Hex) => signMessage(signers, chainId, hash)
  const account = getAccountProvider(config)
  const address = getAddress(config)
  switch (account.type) {
    case 'safe': {
      const signature = await signFn(hash)
      return packSafeSignature(signature, validator, transformSignature)
    }
    case 'nexus': {
      const signature = await signFn(hash)
      return packNexusSignature(signature, validator, transformSignature)
    }
    case 'kernel': {
      const signature = await signFn(wrapKernelMessageHash(hash, address))
      return packKernelSignature(signature, validator, transformSignature)
    }
    case 'startale': {
      const signature = await signFn(hash)
      return packStartaleSignature(signature, validator, transformSignature)
    }
  }
}

// Signs and packs a signature to be EIP-1271 compatible
async function getTypedDataPackedSignature<
  typedData extends TypedData | Record<string, unknown> = TypedData,
  primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
>(
  config: RhinestoneAccountConfig,
  signers: SignerSet | undefined,
  chainId: number,
  validator: ValidatorConfig,
  parameters: HashTypedDataParameters<typedData, primaryType>,
  transformSignature: (signature: Hex) => Hex = (signature) => signature,
) {
  signers = signers ?? convertOwnerSetToSignerSet(config.owners)
  const signFn = (
    parameters: HashTypedDataParameters<typedData, primaryType>,
  ) => signTypedData(signers, chainId, parameters)
  const account = getAccountProvider(config)
  switch (account.type) {
    case 'safe': {
      const signature = await signFn(parameters)
      return packSafeSignature(signature, validator, transformSignature)
    }
    case 'nexus': {
      const signature = await signFn(parameters)
      return packNexusSignature(signature, validator, transformSignature)
    }
    case 'kernel': {
      const address = getAddress(config)
      const signMessageFn = (hash: Hex) => signMessage(signers, chainId, hash)
      const signature = await signMessageFn(
        wrapKernelMessageHash(hashTypedData(parameters), address),
      )
      return packKernelSignature(signature, validator, transformSignature)
    }
    case 'startale': {
      const signature = await signFn(parameters)
      return packStartaleSignature(signature, validator, transformSignature)
    }
  }
}

async function isDeployed(config: RhinestoneAccountConfig, chainId: number) {
  const chain = getChainById(chainId)
  if (!chain) {
    throw new ChainNotSupportedError(chainId)
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
  config: RhinestoneAccountConfig,
  chainId: number,
  session?: Session,
) {
  await deployWithIntent(chainId, config)
  if (session) {
    await enableSmartSession(chainId, config, session)
  }
}

async function deployWithIntent(
  chainId: number,
  config: RhinestoneAccountConfig,
) {
  const chain = getChainById(chainId)
  if (!chain) {
    throw new Error(`Unsupported chain ${chainId}`)
  }
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
    targetChain: chain.id,
    calls: [
      {
        to: zeroAddress,
        data: '0x',
      },
    ],
  })
  await waitForExecution(config, result, true)
}

async function getSmartAccount(
  config: RhinestoneAccountConfig,
  client: PublicClient,
  chainId: number,
) {
  const account = getAccountProvider(config)
  const address = getAddress(config)
  const ownerValidator = getOwnerValidator(config)
  const signers: SignerSet = convertOwnerSetToSignerSet(config.owners)
  const signFn = (hash: Hex) => signMessage(signers, chainId, hash)
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

async function getSmartSessionSmartAccount(
  config: RhinestoneAccountConfig,
  client: PublicClient,
  chainId: number,
  session: Session,
  enableData: EnableSessionData | null,
) {
  const address = getAddress(config)
  const smartSessionValidator = getSmartSessionValidator(config)
  if (!smartSessionValidator) {
    throw new SmartSessionsNotEnabledError()
  }
  const signers: SignerSet = {
    type: 'session',
    session,
    enableData: enableData || undefined,
  }
  const signFn = (hash: Hex) => signMessage(signers, chainId, hash)

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
    case 'startale': {
      return getStartaleSessionSmartAccount(
        client,
        address,
        session,
        smartSessionValidator.address,
        enableData,
        signFn,
      )
    }
  }
}

async function getGuardianSmartAccount(
  config: RhinestoneAccountConfig,
  client: PublicClient,
  chainId: number,
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
  const signFn = (hash: Hex) => signMessage(signers, chainId, hash)

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
  getAddress,
  getAccountProvider,
  getInitCode,
  signEip7702InitData,
  getEip7702InitCall,
  isDeployed,
  deploy,
  getSmartAccount,
  getSmartSessionSmartAccount,
  getGuardianSmartAccount,
  getPackedSignature,
  getTypedDataPackedSignature,
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
