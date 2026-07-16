import {
  type Address,
  concat,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  type Hex,
  keccak256,
  parseAbi,
  slice,
  zeroAddress,
  zeroHash,
} from 'viem'
import type { ModuleSetup } from '../../modules/types'
import { K1_DEFAULT_VALIDATOR_ADDRESS } from '../../modules/validators/k1'
import type { AccountAdapter } from '../adapter'
import { type DeploymentMaterial, deploymentPlan } from '../deployment'
import { encodeErc7579Calls } from '../erc7579-calls'
import type { AccountConstruction } from '../types'
import {
  encodeAddressEnvelope,
  encodeInstallModule,
  encodeUninstallModule,
  primaryOwnerAddresses,
} from './shared'

export { K1_DEFAULT_VALIDATOR_ADDRESS }
const STARTALE_IMPLEMENTATION_ADDRESS =
  '0x000000b8f5f723a680d3d7ee624fe0bc84a6e05a' as const
const STARTALE_FACTORY_ADDRESS =
  '0x0000003b3e7b530b4f981ae80d9350392defef90' as const
const STARTALE_BOOTSTRAP_ADDRESS =
  '0x000000552a5fae3db7a8f3917c435448f49ba6a9' as const
const STARTALE_CREATION_CODE =
  '0x608060405261029d803803806100148161018c565b92833981016040828203126101885781516001600160a01b03811692909190838303610188576020810151906001600160401b03821161018857019281601f8501121561018857835161006e610069826101c5565b61018c565b9481865260208601936020838301011161018857815f926020809301865e8601015260017f754fd8b321c4649cb777ae6fdce7e89e9cceaa31a4f639795c7807eb7f1a27005d823b15610176577f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc80546001600160a01b031916821790557fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b5f80a282511561015e575f8091610146945190845af43d15610156573d91610137610069846101c5565b9283523d5f602085013e6101e0565b505b604051605e908161023f8239f35b6060916101e0565b50505034156101485763b398979f60e01b5f5260045ffd5b634c9c8ce360e01b5f5260045260245ffd5b5f80fd5b6040519190601f01601f191682016001600160401b038111838210176101b157604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b0381116101b157601f01601f191660200190565b9061020457508051156101f557805190602001fd5b63d6bda27560e01b5f5260045ffd5b81511580610235575b610215575090565b639996b31560e01b5f9081526001600160a01b0391909116600452602490fd5b50803b1561020d56fe60806040523615605c575f8073ffffffffffffffffffffffffffffffffffffffff7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc5416368280378136915af43d5f803e156058573d5ff35b3d5ffd5b00' as const

function moduleConfigs(modules: ModuleSetup['validators']) {
  return modules.map((module) => ({
    module: module.address,
    initData: module.initData,
  }))
}

function startaleInitData(input: AccountConstruction): Hex {
  const ownerValidator = input.setup.validators[0]
  if (!ownerValidator) throw new Error('Startale owner validator is required')
  const isK1 =
    ownerValidator.address.toLowerCase() ===
    K1_DEFAULT_VALIDATOR_ADDRESS.toLowerCase()
  let bootstrapData: Hex
  if (isK1) {
    if (!input.owner) throw new Error('Startale K1 owner is required')
    const owners = primaryOwnerAddresses(input.owner)
    if (owners.length !== 1) {
      throw new Error('K1 validator only supports a single owner')
    }
    bootstrapData = encodeFunctionData({
      abi: parseAbi([
        'struct BootstrapConfig {address module;bytes initData;}',
        'struct BootstrapPreValidationHookConfig {uint256 hookType;address module;bytes data;}',
        'function initWithDefaultValidatorAndOtherModules(bytes defaultValidatorInitData,BootstrapConfig[] validators,BootstrapConfig[] executors,BootstrapConfig hook,BootstrapConfig[] fallbacks,BootstrapPreValidationHookConfig[] preValidationHooks)',
      ]),
      functionName: 'initWithDefaultValidatorAndOtherModules',
      args: [
        owners[0],
        moduleConfigs(input.setup.validators.slice(1)),
        moduleConfigs(input.setup.executors),
        { module: zeroAddress, initData: zeroHash },
        moduleConfigs(input.setup.fallbacks),
        [],
      ],
    })
  } else {
    bootstrapData = encodeFunctionData({
      abi: parseAbi([
        'struct BootstrapConfig {address module;bytes initData;}',
        'struct BootstrapPreValidationHookConfig {uint256 hookType;address module;bytes data;}',
        'function init(BootstrapConfig[] validators,BootstrapConfig[] executors,BootstrapConfig hook,BootstrapConfig[] fallbacks,BootstrapPreValidationHookConfig[] preValidationHooks)',
      ]),
      functionName: 'init',
      args: [
        moduleConfigs(input.setup.validators),
        moduleConfigs(input.setup.executors),
        { module: zeroAddress, initData: '0x' },
        moduleConfigs(input.setup.fallbacks),
        [],
      ],
    })
  }
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [STARTALE_BOOTSTRAP_ADDRESS, bootstrapData],
  )
}

function startaleMaterial(input: AccountConstruction): DeploymentMaterial {
  if (input.account.kind !== 'startale') {
    throw new Error('Expected Startale account')
  }
  if (input.eoa) return { address: input.eoa.address }
  if (input.initData && !('factory' in input.initData)) {
    return { address: input.initData.address }
  }
  let factory: Address = STARTALE_FACTORY_ADDRESS
  let factoryData: Hex
  let salt: Hex
  let initializationCallData: Hex
  if (input.initData && 'factory' in input.initData) {
    try {
      const decoded = decodeFunctionData({
        abi: parseAbi(['function createAccount(bytes,bytes32)']),
        data: input.initData.factoryData,
      })
      factory = input.initData.factory
      factoryData = input.initData.factoryData
      salt = decoded.args[1]
      initializationCallData = encodeFunctionData({
        abi: parseAbi(['function initializeAccount(bytes)']),
        functionName: 'initializeAccount',
        args: [decoded.args[0]],
      })
    } catch {
      return { address: input.initData.address }
    }
  } else {
    salt =
      input.account.salt.source === 'explicit'
        ? input.account.salt.value
        : zeroHash
    const initData = startaleInitData(input)
    factoryData = encodeFunctionData({
      abi: parseAbi(['function createAccount(bytes,bytes32)']),
      functionName: 'createAccount',
      args: [initData, salt],
    })
    initializationCallData = encodeFunctionData({
      abi: parseAbi(['function initializeAccount(bytes)']),
      functionName: 'initializeAccount',
      args: [initData],
    })
  }
  const accountInitData = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [STARTALE_IMPLEMENTATION_ADDRESS, initializationCallData],
  )
  const hash = keccak256(
    encodePacked(
      ['bytes1', 'address', 'bytes32', 'bytes32'],
      [
        '0xff',
        factory,
        salt,
        keccak256(concat([STARTALE_CREATION_CODE, accountInitData])),
      ],
    ),
  )
  return { address: slice(hash, 12, 32), factory, factoryData }
}

export function createStartaleAdapter(
  construction: AccountConstruction,
): AccountAdapter {
  if (construction.account.kind !== 'startale') {
    throw new Error('Expected Startale account')
  }
  const validator = construction.setup.validators[0]?.address ?? zeroAddress
  return {
    account: construction.account,
    capabilities: {
      modular: true,
      supportsDeployment: true,
      supportsUserOperations: true,
      supportsEip7702Adoption: false,
      supportsSmartSessions: true,
      supportsOriginSignatureReuse: true,
      signatureEnvelope: { kind: 'startale', validator },
    },
    getIdentity: (input) => ({
      definition: input.account,
      address: startaleMaterial(input).address,
    }),
    getDeploymentPlan: (input) =>
      deploymentPlan(input.chain, startaleMaterial(input), input.deployed),
    encodeCalls: encodeErc7579Calls,
    encodeModuleInstallation: (module) => [encodeInstallModule(module)],
    encodeModuleUninstallation: encodeUninstallModule,
    encodeSignatureEnvelope: ({ envelope, validatorContribution }) => {
      if (envelope.kind !== 'startale') {
        throw new Error('Expected Startale envelope')
      }
      return encodeAddressEnvelope(
        envelope.validator,
        validatorContribution,
        K1_DEFAULT_VALIDATOR_ADDRESS,
      )
    },
  }
}
