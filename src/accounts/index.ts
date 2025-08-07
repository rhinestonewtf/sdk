import {
  type Account,
  type Chain,
  concat,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  type PublicClient,
  pad,
  size,
  toHex,
  zeroAddress,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import { sendTransaction } from '../execution'
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
import {
  getSocialRecoveryValidator,
  getValidator,
} from '../modules/validators/core'
import type { EnableSessionData } from '../modules/validators/smart-sessions'
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
  getPackedSignature as getKernelPackedSignature,
  getSessionSmartAccount as getKernelSessionSmartAccount,
  getSmartAccount as getKernelSmartAccount,
} from './kernel'
import {
  getAddress as getNexusAddress,
  getDeployArgs as getNexusDeployArgs,
  getEip7702InitCall as getNexusEip7702InitCall,
  getGuardianSmartAccount as getNexusGuardianSmartAccount,
  getInstallData as getNexusInstallData,
  getPackedSignature as getNexusPackedSignature,
  getSessionSmartAccount as getNexusSessionSmartAccount,
  getSmartAccount as getNexusSmartAccount,
  signEip7702InitData as signNexusEip7702InitData,
} from './nexus'
import {
  getAddress as getSafeAddress,
  getDeployArgs as getSafeDeployArgs,
  getGuardianSmartAccount as getSafeGuardianSmartAccount,
  getInstallData as getSafeInstallData,
  getPackedSignature as getSafePackedSignature,
  getSessionSmartAccount as getSafeSessionSmartAccount,
  getSmartAccount as getSafeSmartAccount,
} from './safe'
import {
  getAddress as getStartaleAddress,
  getDeployArgs as getStartaleDeployArgs,
  getGuardianSmartAccount as getStartaleGuardianSmartAccount,
  getInstallData as getStartaleInstallData,
  getPackedSignature as getStartalePackedSignature,
  getSessionSmartAccount as getStartaleSessionSmartAccount,
  getSmartAccount as getStartaleSmartAccount,
} from './startale'
import {
  getDeployArgs as getCustomDeployArgs,
  getInstallData as getCustomInstallData,
  getAddress as getCustomAddress,
  getPackedSignature as getCustomPackedSignature,
  getSmartAccount as getCustomSmartAccount,
  getSessionSmartAccount as getCustomSessionSmartAccount,
} from './custom'
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
    case 'custom': {
      return getCustomDeployArgs(config)
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
      throw new Error(`7702 is not supported for account type ${account.type}`)
    }
    case 'custom': {
      throw new Error('7702 is not supported for custom account')
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
      throw new Error(`7702 is not supported for account type ${account.type}`)
    }
    case 'custom': {
      throw new Error('7702 is not supported for custom account')
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
      case 'custom': {
        return getCustomInstallData(config, module)
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
    case 'custom': {
      return getCustomAddress(config)
    }
  }
}

// Signs and packs a signature to be EIP-1271 compatible
async function getPackedSignature(
  config: RhinestoneAccountConfig,
  signers: SignerSet | undefined,
  chain: Chain,
  validator: ValidatorConfig,
  hash: Hex,
  transformSignature: (signature: Hex) => Hex = (signature) => signature,
) {
  signers = signers ?? convertOwnerSetToSignerSet(config.owners)
  const signFn = (hash: Hex) => sign(signers, chain, hash)
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
    case 'startale': {
      return getStartalePackedSignature(
        signFn,
        hash,
        validator,
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
  chain: Chain,
  session?: Session,
) {
  await deployWithIntent(chain, config)
  if (session) {
    await enableSmartSession(chain, config, session)
  }
}

async function deployWithIntent(chain: Chain, config: RhinestoneAccountConfig) {
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
  await sendTransaction(config, {
    targetChain: chain,
    calls: [
      {
        to: zeroAddress,
        data: '0x',
      },
    ],
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
  const signers: SignerSet = convertOwnerSetToSignerSet(config.owners)
  const signFn = (hash: Hex) => sign(signers, chain, hash)
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
    case 'custom': {
      return getCustomSmartAccount(
        config,
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
  const signFn = (hash: Hex) => sign(signers, chain, hash)

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
    case 'custom': {
      return getCustomSessionSmartAccount(
        config,
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
  const signFn = (hash: Hex) => sign(signers, chain, hash)

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

async function sign(signers: SignerSet, chain: Chain, hash: Hex): Promise<Hex> {
  switch (signers.type) {
    case 'owner': {
      switch (signers.kind) {
        case 'ecdsa':
        case 'ecdsa-v0': {
          const signatures = await Promise.all(
            signers.accounts.map((account) => signEcdsa(account, hash)),
          )
          return concat(signatures)
        }
        case 'passkey': {
          return await signPasskey(signers.account, chain, hash)
        }
        case 'multi-factor': {
          const signatures = await Promise.all(
            signers.validators.map(async (validator) => {
              if (validator === null) {
                return '0x'
              }
              const validatorSigners: SignerSet =
                convertOwnerSetToSignerSet(validator)
              return sign(validatorSigners, chain, hash)
            }),
          )
          const data = encodeAbiParameters(
            [
              {
                components: [
                  {
                    internalType: 'bytes32',
                    name: 'packedValidatorAndId',
                    type: 'bytes32',
                  },
                  { internalType: 'bytes', name: 'data', type: 'bytes' },
                ],
                name: 'validators',
                type: 'tuple[]',
              },
            ],
            [
              signers.validators.map((validator, index) => {
                const validatorModule = getValidator(validator)
                return {
                  packedValidatorAndId: concat([
                    pad(toHex(validator.id), {
                      size: 12,
                    }),
                    validatorModule.address,
                  ]),
                  data: signatures[index],
                }
              }),
            ],
          )
          return data
        }
        default: {
          throw new Error('Unsupported owner kind')
        }
      }
    }
    case 'session': {
      const sessionSigners: SignerSet = convertOwnerSetToSignerSet(
        signers.session.owners,
      )
      return sign(sessionSigners, chain, hash)
    }
    case 'guardians': {
      const signatures = await Promise.all(
        signers.guardians.map((account) => signEcdsa(account, hash)),
      )
      return concat(signatures)
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

function convertOwnerSetToSignerSet(owners: OwnerSet): SignerSet {
  switch (owners.type) {
    case 'ecdsa':
    case 'ecdsa-v0': {
      return {
        type: 'owner',
        kind: 'ecdsa',
        accounts: owners.accounts,
      }
    }
    case 'passkey': {
      return {
        type: 'owner',
        kind: 'passkey',
        account: owners.account,
      }
    }
    case 'multi-factor': {
      return {
        type: 'owner',
        kind: 'multi-factor',
        validators: owners.validators.map((validator, index) => {
          switch (validator.type) {
            case 'ecdsa':
            case 'ecdsa-v0': {
              return {
                type: validator.type,
                id: index,
                accounts: validator.accounts,
              }
            }
            case 'passkey': {
              return {
                type: 'passkey',
                id: index,
                account: validator.account,
              }
            }
          }
        }),
      }
    }
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
