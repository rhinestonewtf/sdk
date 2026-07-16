import {
  type Address,
  concat,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  type Hex,
  keccak256,
  parseAbi,
  size,
  zeroAddress,
} from 'viem'
import { OWNABLE_VALIDATOR_ADDRESS } from '../../modules/validators/ownable'
import type { AccountAdapter } from '../adapter'
import { type DeploymentMaterial, deploymentPlan } from '../deployment'
import { encodeErc7579Calls } from '../erc7579-calls'
import type { AccountConstruction } from '../types'
import {
  encodeAddressEnvelope,
  encodeInstallModule,
  encodeUninstallModule,
} from './shared'

export const NEXUS_IMPLEMENTATION_ADDRESS =
  '0x000000000032ddc454c3bdcba80484ad5a798705' as const
export const NEXUS_FACTORY_ADDRESS =
  '0x0000000000679a258c64d2f20f310e12b64b7375' as const
const NEXUS_BOOTSTRAP_ADDRESS =
  '0x00000000006efb61d8c9546ff1b500de3f244ea7' as const
const NEXUS_CREATION_CODE =
  '0x60806040526102aa803803806100148161018c565b92833981016040828203126101885781516001600160a01b03811692909190838303610188576020810151906001600160401b03821161018857019281601f8501121561018857835161006e610069826101c5565b61018c565b9481865260208601936020838301011161018857815f926020809301865e8601015260017f90b772c2cb8a51aa7a8a65fc23543c6d022d5b3f8e2b92eed79fba7eef8293005d823b15610176577f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc80546001600160a01b031916821790557fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b5f80a282511561015e575f8091610146945190845af43d15610156573d91610137610069846101c5565b9283523d5f602085013e6101e0565b505b604051606b908161023f8239f35b6060916101e0565b50505034156101485763b398979f60e01b5f5260045ffd5b634c9c8ce360e01b5f5260045260245ffd5b5f80fd5b6040519190601f01601f191682016001600160401b038111838210176101b157604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b0381116101b157601f01601f191660200190565b9061020457508051156101f557805190602001fd5b63d6bda27560e01b5f5260045ffd5b81511580610235575b610215575090565b639996b31560e01b5f9081526001600160a01b0391909116600452602490fd5b50803b1561020d56fe60806040523615605c575f8073ffffffffffffffffffffffffffffffffffffffff7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc5416368280378136915af43d5f803e156058573d5ff35b3d5ffd5b00fea164736f6c634300081b000a' as const

export function nexusDefaultValidator(version: string | undefined): Address {
  switch (version) {
    case '1.0.2':
      return '0x0000002d6db27c52e3c11c1cf24072004ac75cba'
    case '1.2.0':
      return '0x00000000d12897ddadc2044614a9677b191a2d95'
    case 'rhinestone-1.0.0-beta':
      return '0x0000000000e9e6e96bcaa3c113187cdb7e38aed9'
    default:
      return OWNABLE_VALIDATOR_ADDRESS
  }
}

export interface NexusDeploymentMaterial extends DeploymentMaterial {
  readonly initializationCallData?: Hex
  readonly implementation?: Address
  readonly salt?: Hex
}

export function nexusMaterial(
  input: AccountConstruction,
): NexusDeploymentMaterial {
  if (input.account.kind !== 'nexus') throw new Error('Expected Nexus account')
  if (input.eoa) return { address: input.eoa.address }
  if (input.initData && !('factory' in input.initData)) {
    return { address: input.initData.address }
  }
  let factory: Address = NEXUS_FACTORY_ADDRESS
  let factoryData: Hex
  const implementation: Address = NEXUS_IMPLEMENTATION_ADDRESS
  let initializationCallData: Hex
  let salt: Hex
  if (input.initData && 'factory' in input.initData) {
    const decoded = decodeFunctionData({
      abi: parseAbi(['function createAccount(bytes,bytes32)']),
      data: input.initData.factoryData,
    })
    factory = input.initData.factory
    factoryData = input.initData.factoryData
    const initData = decoded.args[0]
    salt = decoded.args[1]
    initializationCallData = encodeFunctionData({
      abi: parseAbi(['function initializeAccount(bytes)']),
      functionName: 'initializeAccount',
      args: [initData],
    })
  } else {
    salt =
      input.account.salt.source === 'explicit'
        ? input.account.salt.value
        : keccak256('0x')
    const defaultValidator = input.setup.validators.find(
      (module) => module.address === OWNABLE_VALIDATOR_ADDRESS,
    )
    const defaultValidatorInitData = defaultValidator?.initData ?? '0x'
    const validators = input.setup.validators.filter(
      (module) => module.address !== OWNABLE_VALIDATOR_ADDRESS,
    )
    const configs = (modules: typeof input.setup.validators) =>
      modules.map((module) => ({
        module: module.address,
        initData: module.initData,
      }))
    const bootstrapData =
      size(defaultValidatorInitData) > 0
        ? encodeFunctionData({
            abi: parseAbi([
              'struct BootstrapConfig {address module;bytes initData;}',
              'struct BootstrapPreValidationHookConfig {uint256 hookType;address module;bytes data;}',
              'function initNexusWithDefaultValidatorAndOtherModulesNoRegistry(bytes defaultValidatorInitData,BootstrapConfig[] validators,BootstrapConfig[] executors,BootstrapConfig hook,BootstrapConfig[] fallbacks,BootstrapPreValidationHookConfig[] preValidationHooks)',
            ]),
            functionName:
              'initNexusWithDefaultValidatorAndOtherModulesNoRegistry',
            args: [
              defaultValidatorInitData,
              configs(validators),
              configs(input.setup.executors),
              { module: zeroAddress, initData: '0x' },
              configs(input.setup.fallbacks),
              [],
            ],
          })
        : encodeFunctionData({
            abi: parseAbi([
              'struct BootstrapConfig {address module;bytes initData;}',
              'struct BootstrapPreValidationHookConfig {uint256 hookType;address module;bytes data;}',
              'function initNexusNoRegistry(BootstrapConfig[] validators,BootstrapConfig[] executors,BootstrapConfig hook,BootstrapConfig[] fallbacks,BootstrapPreValidationHookConfig[] preValidationHooks)',
            ]),
            functionName: 'initNexusNoRegistry',
            args: [
              configs(validators),
              configs(input.setup.executors),
              { module: zeroAddress, initData: '0x' },
              configs(input.setup.fallbacks),
              [],
            ],
          })
    const initData = encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes' }],
      [NEXUS_BOOTSTRAP_ADDRESS, bootstrapData],
    )
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
    [
      { name: 'address', type: 'address' },
      { name: 'calldata', type: 'bytes' },
    ],
    [implementation, initializationCallData],
  )
  const address = getContractAddress({
    opcode: 'CREATE2',
    from: factory,
    salt,
    bytecode: concat([NEXUS_CREATION_CODE, accountInitData]),
  })
  return {
    address,
    factory,
    factoryData,
    implementation,
    initializationCallData,
    salt,
  }
}

export function createNexusAdapter(
  construction: AccountConstruction,
): AccountAdapter {
  if (construction.account.kind !== 'nexus') {
    throw new Error('Expected Nexus account')
  }
  const version =
    construction.account.version.source === 'explicit'
      ? construction.account.version.value
      : undefined
  const validator = construction.setup.validators[0]?.address ?? zeroAddress
  return {
    account: construction.account,
    capabilities: {
      modular: true,
      supportsDeployment: true,
      supportsUserOperations: true,
      supportsEip7702Adoption: true,
      supportsSmartSessions: true,
      supportsOriginSignatureReuse: true,
      signatureEnvelope: { kind: 'nexus', validator },
    },
    getIdentity: (input) => ({
      definition: input.account,
      address: nexusMaterial(input).address,
    }),
    getDeploymentPlan: (input) =>
      deploymentPlan(input.chain, nexusMaterial(input), input.deployed),
    encodeCalls: encodeErc7579Calls,
    encodeModuleInstallation: (module) => [encodeInstallModule(module)],
    encodeModuleUninstallation: encodeUninstallModule,
    encodeSignatureEnvelope: ({ envelope, validatorContribution }) => {
      if (envelope.kind !== 'nexus') throw new Error('Expected Nexus envelope')
      return encodeAddressEnvelope(
        envelope.validator,
        validatorContribution,
        nexusDefaultValidator(version),
      )
    },
  }
}
