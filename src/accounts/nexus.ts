import type { Abi, Account, Address, Chain, Hex, PublicClient } from 'viem'
import {
  concat,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  keccak256,
  parseAbi,
  size,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem'
import {
  entryPoint07Abi,
  entryPoint07Address,
  getUserOperationHash,
  type SmartAccount,
  type SmartAccountImplementation,
  toSmartAccount,
} from 'viem/account-abstraction'

import { getSetup as getModuleSetup } from '../modules'
import type { Module } from '../modules/common'
import { getMockSignature } from '../modules/validators'
import { OWNABLE_VALIDATOR_ADDRESS } from '../modules/validators/core'
import type { NexusAccount, OwnerSet, RhinestoneAccountConfig } from '../types'
import {
  AccountConfigurationNotSupportedError,
  Eip712DomainNotAvailableError,
  SigningNotSupportedForAccountError,
} from './error'
import { encode7579Calls, getAccountNonce, type ValidatorConfig } from './utils'

const NEXUS_DEFAULT_VALIDATOR_ADDRESS: Address = OWNABLE_VALIDATOR_ADDRESS
const NEXUS_VERSION = '1.2.0'

const NEXUS_IMPLEMENTATION_ADDRESS: Address =
  '0x000000000032ddc454c3bdcba80484ad5a798705'
const NEXUS_FACTORY_ADDRESS: Address =
  '0x0000000000679a258c64d2f20f310e12b64b7375'
const NEXUS_BOOTSTRAP_ADDRESS: Address =
  '0x00000000006efb61d8c9546ff1b500de3f244ea7'

// Nexus 1.2.1 ships a new implementation + factory; the bootstrap and the proxy
// creation code are unchanged from 1.2.0. Opt in with `account.version = '1.2.1'`.
const NEXUS_IMPLEMENTATION_1_2_1: Address =
  '0x000000000d41c0bf0063dba53343389cdb2c9c78'
const NEXUS_FACTORY_1_2_1: Address =
  '0x0000000099d5576c73a3b190dabeeaa0f128ce6b'

const NEXUS_IMPLEMENTATION_1_0_0: Address =
  '0x000000039dfcad030719b07296710f045f0558f7'
const NEXUS_BOOTSTRAP_1_0_0: Address =
  '0x00000008c901d8871b6f6942de0b5d9ccf3873d3'
const NEXUS_K1_VALIDATOR: Address = '0x00000004171351c442b202678c48d8ab5b321e8f'

const NEXUS_CREATION_CODE =
  '0x60806040526102aa803803806100148161018c565b92833981016040828203126101885781516001600160a01b03811692909190838303610188576020810151906001600160401b03821161018857019281601f8501121561018857835161006e610069826101c5565b61018c565b9481865260208601936020838301011161018857815f926020809301865e8601015260017f90b772c2cb8a51aa7a8a65fc23543c6d022d5b3f8e2b92eed79fba7eef8293005d823b15610176577f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc80546001600160a01b031916821790557fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b5f80a282511561015e575f8091610146945190845af43d15610156573d91610137610069846101c5565b9283523d5f602085013e6101e0565b505b604051606b908161023f8239f35b6060916101e0565b50505034156101485763b398979f60e01b5f5260045ffd5b634c9c8ce360e01b5f5260045260245ffd5b5f80fd5b6040519190601f01601f191682016001600160401b038111838210176101b157604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b0381116101b157601f01601f191660200190565b9061020457508051156101f557805190602001fd5b63d6bda27560e01b5f5260045ffd5b81511580610235575b610215575090565b639996b31560e01b5f9081526001600160a01b0391909116600452602490fd5b50803b1561020d56fe60806040523615605c575f8073ffffffffffffffffffffffffffffffffffffffff7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc5416368280378136915af43d5f803e156058573d5ff35b3d5ffd5b00fea164736f6c634300081b000a'

// Resolves the implementation + factory a fresh account deploys against. All
// versions except '1.2.1' deploy the previous (1.2.0) contracts.
function getNexusDeployment(version: NexusAccount['version']): {
  implementation: Address
  factory: Address
} {
  if (version === '1.2.1') {
    return {
      implementation: NEXUS_IMPLEMENTATION_1_2_1,
      factory: NEXUS_FACTORY_1_2_1,
    }
  }
  return {
    implementation: NEXUS_IMPLEMENTATION_ADDRESS,
    factory: NEXUS_FACTORY_ADDRESS,
  }
}

// Whether the factory is one of the current Nexus factories (1.2.0 / 1.2.1),
// which share the same proxy creation code. Legacy (1.0.0) factories use a
// different proxy and account init encoding.
function isNexusV1Factory(factory: Address): boolean {
  const normalized = factory.toLowerCase()
  return (
    normalized === NEXUS_FACTORY_ADDRESS || normalized === NEXUS_FACTORY_1_2_1
  )
}

// Maps a current Nexus factory to the implementation it deploys, so a persisted
// v1.2.1 `initData` payload recomputes against the right implementation (and the
// 7702 init helpers sign/return it) rather than defaulting to 1.2.0.
function implementationForFactory(factory: Address): Address {
  return factory.toLowerCase() === NEXUS_FACTORY_1_2_1
    ? NEXUS_IMPLEMENTATION_1_2_1
    : NEXUS_IMPLEMENTATION_ADDRESS
}

function getDeployArgs(config: RhinestoneAccountConfig) {
  if (config.initData) {
    if (!('factory' in config.initData)) {
      return null
    }

    const { factory, factoryData } = config.initData

    const v1Result = tryDecodeV1FactoryData(factory, factoryData)
    if (v1Result) {
      return v1Result
    }

    const v0Result = tryDecodeV0FactoryData(factory, factoryData)
    if (v0Result) {
      return v0Result
    }

    throw new AccountConfigurationNotSupportedError(
      'Invalid factory data: unrecognized schema',
      'nexus',
    )
  }
  const account = config.account
  const defaultSalt = keccak256('0x')
  const salt = (account as NexusAccount)?.salt ?? defaultSalt
  const { implementation, factory } = getNexusDeployment(
    (account as NexusAccount)?.version,
  )
  const moduleSetup = getModuleSetup(config)
  // Filter out the default validator
  const defaultValidator = moduleSetup.validators.find(
    (v) => v.address === NEXUS_DEFAULT_VALIDATOR_ADDRESS,
  )
  const defaultValidatorInitData = defaultValidator
    ? defaultValidator.initData
    : '0x'
  const validators = moduleSetup.validators.filter(
    (v) => v.address !== NEXUS_DEFAULT_VALIDATOR_ADDRESS,
  )
  const bootstrapData = size(defaultValidatorInitData)
    ? encodeFunctionData({
        abi: parseAbi([
          'struct BootstrapConfig {address module;bytes initData;}',
          'struct BootstrapPreValidationHookConfig {uint256 hookType;address module;bytes data;}',
          'function initNexusWithDefaultValidatorAndOtherModulesNoRegistry(bytes calldata defaultValidatorInitData,BootstrapConfig[] calldata validators,BootstrapConfig[] calldata executors,BootstrapConfig calldata hook,BootstrapConfig[] calldata fallbacks,BootstrapPreValidationHookConfig[] calldata preValidationHooks) external',
        ]),
        functionName: 'initNexusWithDefaultValidatorAndOtherModulesNoRegistry',
        args: [
          defaultValidatorInitData,
          validators.map((v) => ({
            module: v.address,
            initData: v.initData,
          })),
          moduleSetup.executors.map((e) => ({
            module: e.address,
            initData: e.initData,
          })),
          {
            module: zeroAddress,
            initData: '0x',
          },
          moduleSetup.fallbacks.map((f) => ({
            module: f.address,
            initData: f.initData,
          })),
          [],
        ],
      })
    : encodeFunctionData({
        abi: parseAbi([
          'struct BootstrapConfig {address module;bytes initData;}',
          'struct BootstrapPreValidationHookConfig {uint256 hookType;address module;bytes data;}',
          'function initNexusNoRegistry(BootstrapConfig[] calldata validators,BootstrapConfig[] calldata executors,BootstrapConfig calldata hook,BootstrapConfig[] calldata fallbacks,BootstrapPreValidationHookConfig[] calldata preValidationHooks) external',
        ]),
        functionName: 'initNexusNoRegistry',
        args: [
          validators.map((v) => ({
            module: v.address,
            initData: v.initData,
          })),
          moduleSetup.executors.map((e) => ({
            module: e.address,
            initData: e.initData,
          })),
          {
            module: zeroAddress,
            initData: '0x',
          },
          moduleSetup.fallbacks.map((f) => ({
            module: f.address,
            initData: f.initData,
          })),
          [],
        ],
      })
  const initData = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [NEXUS_BOOTSTRAP_ADDRESS, bootstrapData],
  )
  const factoryData = encodeFunctionData({
    abi: parseAbi(['function createAccount(bytes,bytes32)']),
    functionName: 'createAccount',
    args: [initData, salt],
  })

  const initializationCallData = encodeFunctionData({
    abi: parseAbi(['function initializeAccount(bytes)']),
    functionName: 'initializeAccount',
    args: [initData],
  })

  return {
    factory,
    factoryData,
    salt,
    implementation,
    initializationCallData,
    initData,
  }
}

function getAddress(config: RhinestoneAccountConfig) {
  const deployArgs = getDeployArgs(config)
  if (!deployArgs) {
    if (config.initData?.address) {
      return config.initData.address
    }
    throw new Error('Cannot derive address: deploy args not available')
  }
  const { factory, salt, initializationCallData, implementation } = deployArgs

  const creationCode = isNexusV1Factory(factory)
    ? NEXUS_CREATION_CODE
    : '0x603d3d8160223d3973000000039dfcad030719b07296710f045f0558f760095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3'

  const accountInitData = isNexusV1Factory(factory)
    ? encodeAbiParameters(
        [
          {
            name: 'address',
            type: 'address',
          },
          {
            name: 'calldata',
            type: 'bytes',
          },
        ],
        [implementation, initializationCallData],
      )
    : '0x'
  const address = getContractAddress({
    opcode: 'CREATE2',
    from: factory,
    salt,
    bytecode: concat([creationCode, accountInitData]),
  })
  return address
}

function getEip712Domain(config: RhinestoneAccountConfig, chain: Chain) {
  if (config.initData) {
    throw new Eip712DomainNotAvailableError(
      'Existing Nexus accounts are not yet supported',
    )
  }
  return {
    name: 'Nexus',
    version: NEXUS_VERSION,
    chainId: chain.id,
    verifyingContract: getAddress(config),
    salt: zeroHash,
  }
}

function getInstallData(module: Module) {
  return encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'installModule',
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
            name: 'initData',
          },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'installModule',
    args: [module.type, module.address, module.initData],
  })
}

// On Nexus the OwnableValidator is the hardwired default validator. It cannot
// be added via `installModule` (reverts `DefaultValidatorAlreadyInstalled`), so
// it is initialized out-of-band by calling its `onInstall` directly with the
// same init data `installModule` would have passed (`abi.encode(threshold, owners)`).
function getDefaultValidatorInitData(module: Module): Hex {
  return encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'onInstall',
        inputs: [{ type: 'bytes', name: 'data' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'onInstall',
    args: [module.initData],
  })
}

// Whether the deploy bootstrap will initialize the default validator — i.e. the
// account is configured with an Ownable/ECDSA owner set. Mirrors the
// `defaultValidatorInitData` computation in `getDeployArgs`, so a counterfactual
// (not-yet-deployed) account whose deployment initializes the default validator
// is treated as already-initialized rather than emitting a second `onInstall`.
function isDefaultValidatorConfigured(
  config: RhinestoneAccountConfig,
): boolean {
  if (config.initData) {
    return false
  }
  const moduleSetup = getModuleSetup(config)
  const defaultValidator = moduleSetup.validators.find(
    (v) => v.address === NEXUS_DEFAULT_VALIDATOR_ADDRESS,
  )
  return defaultValidator ? size(defaultValidator.initData) > 0 : false
}

function getDefaultValidatorAddress(version: NexusAccount['version']): Address {
  if (!version) {
    return NEXUS_DEFAULT_VALIDATOR_ADDRESS
  }
  switch (version) {
    case '1.0.2':
      return '0x0000002d6db27c52e3c11c1cf24072004ac75cba'
    case '1.2.0':
      return '0x00000000d12897ddadc2044614a9677b191a2d95'
    case '1.2.1':
      return NEXUS_DEFAULT_VALIDATOR_ADDRESS
    case 'rhinestone-1.0.0-beta':
      return '0x0000000000e9e6e96bcaa3c113187cdb7e38aed9'
    case 'rhinestone-1.0.0':
      return NEXUS_DEFAULT_VALIDATOR_ADDRESS
  }
}

async function packSignature(
  signature: Hex,
  validator: ValidatorConfig,
  transformSignature: (signature: Hex) => Hex = (signature) => signature,
  defaultValidatorAddress: Address = NEXUS_DEFAULT_VALIDATOR_ADDRESS,
) {
  const validatorAddress =
    validator.address === defaultValidatorAddress
      ? zeroAddress
      : validator.address
  const packedSig = encodePacked(
    ['address', 'bytes'],
    [validatorAddress, transformSignature(signature)],
  )
  return packedSig
}

async function getSmartAccount(
  client: PublicClient,
  address: Address,
  owners: OwnerSet,
  validatorAddress: Address,
  sign: (hash: Hex) => Promise<Hex>,
  defaultValidatorAddress: Address = NEXUS_DEFAULT_VALIDATOR_ADDRESS,
) {
  return getBaseSmartAccount(
    address,
    client,
    validatorAddress,
    async () => {
      return getMockSignature(owners)
    },
    sign,
    defaultValidatorAddress,
  )
}

async function getGuardianSmartAccount(
  client: PublicClient,
  address: Address,
  guardians: OwnerSet,
  validatorAddress: Address,
  sign: (hash: Hex) => Promise<Hex>,
  defaultValidatorAddress: Address = NEXUS_DEFAULT_VALIDATOR_ADDRESS,
) {
  return await getBaseSmartAccount(
    address,
    client,
    validatorAddress,
    async () => {
      return getMockSignature(guardians)
    },
    async (hash) => {
      return await sign(hash)
    },
    defaultValidatorAddress,
  )
}

async function getBaseSmartAccount(
  address: Address,
  client: PublicClient,
  nonceValidatorAddress: Address,
  getStubSignature: () => Promise<Hex>,
  signUserOperation: (hash: Hex) => Promise<Hex>,
  defaultValidatorAddress: Address,
): Promise<SmartAccount<SmartAccountImplementation<Abi, '0.7'>>> {
  return await toSmartAccount({
    client,
    entryPoint: {
      abi: entryPoint07Abi,
      address: entryPoint07Address,
      version: '0.7',
    },
    async decodeCalls() {
      throw new Error('Not implemented')
    },
    async encodeCalls(calls) {
      return encode7579Calls({
        mode: {
          type: calls.length > 1 ? 'batchcall' : 'call',
          revertOnError: false,
          selector: '0x',
          context: '0x',
        },
        callData: calls,
      })
    },
    async getAddress() {
      return address
    },
    async getFactoryArgs() {
      return {}
    },
    async getNonce(args) {
      const validatorAddress =
        nonceValidatorAddress === defaultValidatorAddress
          ? zeroAddress
          : nonceValidatorAddress
      const TIMESTAMP_ADJUSTMENT = 16777215n // max value for size 3
      const defaultedKey = (args?.key ?? 0n) % TIMESTAMP_ADJUSTMENT
      const defaultedValidationMode = '0x00'
      const key = concat([
        toHex(defaultedKey, { size: 3 }),
        defaultedValidationMode,
        validatorAddress,
      ])
      return getAccountNonce(client, {
        address,
        entryPointAddress: entryPoint07Address,
        key: BigInt(key),
      })
    },
    async getStubSignature() {
      return getStubSignature()
    },
    async signMessage() {
      throw new Error('Not implemented')
    },
    async signTypedData() {
      throw new Error('Not implemented')
    },
    async signUserOperation(parameters) {
      const { chainId = client.chain?.id, ...userOperation } = parameters

      if (!chainId) throw new Error('Chain id not found')

      const hash = getUserOperationHash({
        userOperation: {
          ...userOperation,
          sender: userOperation.sender ?? (await this.getAddress()),
          signature: '0x' as Hex,
        },
        entryPointAddress: entryPoint07Address,
        entryPointVersion: '0.7',
        chainId: chainId,
      })
      return await signUserOperation(hash)
    },
  })
}

async function signEip7702InitData(
  config: RhinestoneAccountConfig,
  eoa: Account,
) {
  const deployArgs = getDeployArgs(config)
  if (!deployArgs) {
    throw new Error('Cannot sign EIP-7702 init data: deploy args not available')
  }
  const { initData, implementation } = deployArgs
  if (!eoa.signTypedData) {
    throw new SigningNotSupportedForAccountError()
  }
  const signature = await eoa.signTypedData({
    domain: {
      name: 'Nexus',
      version: NEXUS_VERSION,
    },
    types: {
      Initialize: [
        { name: 'nexus', type: 'address' },
        { name: 'chainIds', type: 'uint256[]' },
        { name: 'initData', type: 'bytes' },
      ],
    },
    primaryType: 'Initialize',
    message: {
      nexus: implementation,
      chainIds: [0n],
      initData,
    },
  })
  return signature
}

function getEip7702InitCall(config: RhinestoneAccountConfig, signature: Hex) {
  function getEncodedData(initData: Hex): Hex {
    const chainIds = [0n]
    const chainIdIndex = 0n
    const chainIdsLength = 1n
    const encodedData = encodePacked(
      ['uint256', 'uint256', 'uint256', 'bytes'],
      [chainIdIndex, chainIdsLength, chainIds[0], initData],
    )
    return encodedData
  }

  const deployArgs = getDeployArgs(config)
  if (!deployArgs) {
    throw new Error('Cannot get EIP-7702 init call: deploy args not available')
  }
  const { initData, implementation } = deployArgs
  const encodedData = getEncodedData(initData)
  const accountFullData = concat([signature, encodedData])
  const accountInitCallData = encodeFunctionData({
    abi: [
      {
        type: 'function',
        inputs: [
          {
            type: 'bytes',
            name: 'initData',
          },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
        name: 'initializeAccount',
      },
    ],
    functionName: 'initializeAccount',
    args: [accountFullData],
  })

  return {
    initData: accountInitCallData,
    contract: implementation,
  }
}

function tryDecodeV1FactoryData(factory: Address, factoryData: Hex) {
  try {
    const decoded = decodeFunctionData({
      abi: parseAbi(['function createAccount(bytes,bytes32)']),
      data: factoryData,
    })
    const initData = decoded.args[0]
    const salt = decoded.args[1]
    const initializationCallData = encodeFunctionData({
      abi: parseAbi(['function initializeAccount(bytes)']),
      functionName: 'initializeAccount',
      args: [initData],
    })
    return {
      salt,
      factory,
      factoryData,
      implementation: implementationForFactory(factory),
      initData,
      initializationCallData,
    }
  } catch (error) {
    if (isAbiDecodingError(error)) {
      return null
    }
    throw error
  }
}

function tryDecodeV0FactoryData(factory: Address, factoryData: Hex) {
  try {
    const decoded = decodeFunctionData({
      abi: parseAbi([
        'function createAccount(address eoaOwner,uint256 index,address[] attesters,uint8 threshold)',
      ]),
      data: factoryData,
    })
    const owner = decoded.args[0]
    const index = decoded.args[1]
    const attesters = decoded.args[2]
    const threshold = decoded.args[3]
    const salt = keccak256(
      encodePacked(
        ['address', 'uint256', 'address[]', 'uint8'],
        [owner, index, attesters, threshold],
      ),
    )
    const implementation =
      factory.toLowerCase() === NEXUS_FACTORY_ADDRESS
        ? NEXUS_IMPLEMENTATION_ADDRESS
        : NEXUS_IMPLEMENTATION_1_0_0

    const registry = zeroAddress
    const bootstrapData = encodeFunctionData({
      abi: parseAbi([
        'function initNexusWithSingleValidator(address validator,bytes data,address registry,address[] attesters,uint8 threshold)',
      ]),
      functionName: 'initNexusWithSingleValidator',
      args: [NEXUS_K1_VALIDATOR, owner, registry, attesters, threshold],
    })
    const initData = encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes' }],
      [NEXUS_BOOTSTRAP_1_0_0, bootstrapData],
    )
    const initializationCallData = encodeFunctionData({
      abi: parseAbi(['function initializeAccount(bytes)']),
      functionName: 'initializeAccount',
      args: [initData],
    })
    return {
      salt,
      factory,
      factoryData,
      implementation,
      initData,
      initializationCallData,
    }
  } catch (error) {
    if (isAbiDecodingError(error)) {
      return null
    }
    throw error
  }
}

function isAbiDecodingError(error: unknown): boolean {
  return (
    error instanceof Error && error.name === 'AbiFunctionSignatureNotFoundError'
  )
}

export {
  getEip712Domain,
  getInstallData,
  getDefaultValidatorInitData,
  isDefaultValidatorConfigured,
  getAddress,
  getDefaultValidatorAddress,
  packSignature,
  getDeployArgs,
  getSmartAccount,
  getGuardianSmartAccount,
  signEip7702InitData,
  getEip7702InitCall,
}
