import type { Address, Hex, PublicClient } from 'viem'
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
  zeroAddress,
} from 'viem'
import { getSetup as getModuleSetup } from '../modules'
import type { Module } from '../modules/common'
import { OWNABLE_VALIDATOR_ADDRESS } from '../modules/validators/core'
import type { EnableSessionData } from '../modules/validators/smart-sessions'
import type { OwnerSet, RhinestoneAccountConfig, Session } from '../types'
import { AccountConfigurationNotSupportedError } from './error'
import {
  getGuardianSmartAccount as getNexusGuardianSmartAccount,
  getInstallData as getNexusInstallData,
  getSessionSmartAccount as getNexusSessionSmartAccount,
  getSmartAccount as getNexusSmartAccount,
  packSignature as packNexusSignature,
} from './nexus'
import type { ValidatorConfig } from './utils'

const K1_DEFAULT_VALIDATOR_ADDRESS: Address =
  '0x00000072f286204bb934ed49d8969e86f7dec7b1'

// const IMPLEMENTATION_ADDRESS: Address =
//   '0x3d485adec9434b2a465e210d007ef39f323daf79'
// const FACTORY_ADDRESS: Address = '0x3b12b9e11c379ba8621cb04bc410dae9e99761a0'
// // const BOOTSTRAP_ADDRESS: Address = '0x000000552A5fAe3Db7a8F3917C435448F49BA6a9'

const CREATION_CODE =
  '0x6054600f3d396034805130553df3fe63906111273d3560e01c14602b57363d3d373d3d3d3d369030545af43d82803e156027573d90f35b3d90fd5b30543d5260203df3'

// const NEXUS_DEFAULT_VALIDATOR_ADDRESS: Address = OWNABLE_VALIDATOR_ADDRESS

// const NEXUS_IMPLEMENTATION_ADDRESS: Address =
//   '0x000000000032dDC454C3BDcba80484Ad5A798705'
// const NEXUS_FACTORY_ADDRESS: Address =
//   '0x0000000000679A258c64d2F20F310e12B64b7375'
// const NEXUS_BOOTSTRAP_ADDRESS: Address =
//   '0x00000000006eFb61D8c9546FF1B500de3f244EA7'

// const NEXUS_IMPLEMENTATION_1_0_0: Address =
//   '0x000000039dfcad030719b07296710f045f0558f7'
// const NEXUS_BOOTSTRAP_1_0_0: Address =
//   '0x00000008c901d8871b6f6942de0b5d9ccf3873d3'
// const NEXUS_K1_VALIDATOR: Address = '0x00000004171351c442b202678c48d8ab5b321e8f'

interface AccountDeploymentConfig {
  owners: {
    address: Address
    weight: number
    privateKey: Hex
  }[]
  threshold: number
}

function getDeployArgs(config: RhinestoneAccountConfig) {
  // if (config.initData) {
  //   const factoryData = decodeFunctionData({
  //     abi: parseAbi([
  //       'function createAccount(address eoaOwner,uint256 index,address[] attesters,uint8 threshold)',
  //     ]),
  //     data: config.initData.factoryData,
  //   })
  //   if (factoryData.functionName !== 'createAccount') {
  //     throw new AccountConfigurationNotSupportedError(
  //       'Invalid factory data',
  //       'nexus',
  //     )
  //   }
  //   const owner = factoryData.args[0]
  //   const index = factoryData.args[1]
  //   const attesters = factoryData.args[2]
  //   const threshold = factoryData.args[3]
  //   const salt = keccak256(
  //     encodePacked(
  //       ['address', 'uint256', 'address[]', 'uint8'],
  //       [owner, index, attesters, threshold],
  //     ),
  //   )
  //   const implementation =
  //     config.initData.factory === NEXUS_FACTORY_ADDRESS
  //       ? NEXUS_IMPLEMENTATION_ADDRESS
  //       : NEXUS_IMPLEMENTATION_1_0_0

  //   const registry = zeroAddress
  //   const bootstrapData = encodeFunctionData({
  //     abi: parseAbi([
  //       'function initNexusWithSingleValidator(address validator,bytes data,address registry,address[] attesters,uint8 threshold)',
  //     ]),
  //     functionName: 'initNexusWithSingleValidator',
  //     args: [NEXUS_K1_VALIDATOR, owner, registry, attesters, threshold],
  //   })
  //   const initData = encodeAbiParameters(
  //     [{ type: 'address' }, { type: 'bytes' }],
  //     [NEXUS_BOOTSTRAP_1_0_0, bootstrapData],
  //   )
  //   const initializationCallData = encodeFunctionData({
  //     abi: parseAbi(['function initializeAccount(bytes)']),
  //     functionName: 'initializeAccount',
  //     args: [initData],
  //   })

  //   return {
  //     salt,
  //     factory: config.initData.factory,
  //     factoryData: config.initData.factoryData,
  //     implementation,
  //     initData,
  //     initializationCallData,
  //   }
  // }
  // const salt = keccak256('0x')
  // const moduleSetup = getModuleSetup(config)
  // // Filter out the default validator
  // const defaultValidator = moduleSetup.validators.find(
  //   (v) => v.address === NEXUS_DEFAULT_VALIDATOR_ADDRESS,
  // )
  // const defaultValidatorInitData = defaultValidator
  //   ? defaultValidator.initData
  //   : '0x'
  // const validators = moduleSetup.validators.filter(
  //   (v) => v.address !== NEXUS_DEFAULT_VALIDATOR_ADDRESS,
  // )
  // const bootstrapData = size(defaultValidatorInitData)
  //   ? encodeFunctionData({
  //       abi: parseAbi([
  //         'struct BootstrapConfig {address module;bytes initData;}',
  //         'struct BootstrapPreValidationHookConfig {uint256 hookType;address module;bytes data;}',
  //         'function initNexusWithDefaultValidatorAndOtherModulesNoRegistry(bytes calldata defaultValidatorInitData,BootstrapConfig[] calldata validators,BootstrapConfig[] calldata executors,BootstrapConfig calldata hook,BootstrapConfig[] calldata fallbacks,BootstrapPreValidationHookConfig[] calldata preValidationHooks) external',
  //       ]),
  //       functionName: 'initNexusWithDefaultValidatorAndOtherModulesNoRegistry',
  //       args: [
  //         defaultValidatorInitData,
  //         validators.map((v) => ({
  //           module: v.address,
  //           initData: v.initData,
  //         })),
  //         moduleSetup.executors.map((e) => ({
  //           module: e.address,
  //           initData: e.initData,
  //         })),
  //         {
  //           module: zeroAddress,
  //           initData: '0x',
  //         },
  //         moduleSetup.fallbacks.map((f) => ({
  //           module: f.address,
  //           initData: f.initData,
  //         })),
  //         [],
  //       ],
  //     })
  //   : encodeFunctionData({
  //       abi: parseAbi([
  //         'struct BootstrapConfig {address module;bytes initData;}',
  //         'struct BootstrapPreValidationHookConfig {uint256 hookType;address module;bytes data;}',
  //         'function initNexusNoRegistry(BootstrapConfig[] calldata validators,BootstrapConfig[] calldata executors,BootstrapConfig calldata hook,BootstrapConfig[] calldata fallbacks,BootstrapPreValidationHookConfig[] calldata preValidationHooks) external',
  //       ]),
  //       functionName: 'initNexusNoRegistry',
  //       args: [
  //         validators.map((v) => ({
  //           module: v.address,
  //           initData: v.initData,
  //         })),
  //         moduleSetup.executors.map((e) => ({
  //           module: e.address,
  //           initData: e.initData,
  //         })),
  //         {
  //           module: zeroAddress,
  //           initData: '0x',
  //         },
  //         moduleSetup.fallbacks.map((f) => ({
  //           module: f.address,
  //           initData: f.initData,
  //         })),
  //         [],
  //       ],
  //     })
  // const initData = encodeAbiParameters(
  //   [{ type: 'address' }, { type: 'bytes' }],
  //   [NEXUS_BOOTSTRAP_ADDRESS, bootstrapData],
  // )
  // const factoryData = encodeFunctionData({
  //   abi: parseAbi(['function createAccount(bytes,bytes32)']),
  //   functionName: 'createAccount',
  //   args: [initData, salt],
  // })

  // const initializationCallData = encodeFunctionData({
  //   abi: parseAbi(['function initializeAccount(bytes)']),
  //   functionName: 'initializeAccount',
  //   args: [initData],
  // })

  // return {
  //   factory: NEXUS_FACTORY_ADDRESS,
  //   factoryData,
  //   salt,
  //   implementation: NEXUS_IMPLEMENTATION_ADDRESS,
  //   initializationCallData,
  //   initData,
  // }
  if (config.initData) {
    throw new AccountConfigurationNotSupportedError(
      'Invalid init data',
      'passport',
    )
  }
}

function getAddress(config: RhinestoneAccountConfig) {
  const { factory, salt, initializationCallData } = getDeployArgs(config)

  const creationCode = CREATION_CODE
  const address = getContractAddress({
    opcode: 'CREATE2',
    from: factory,
    salt,
    bytecode: concat([creationCode, initializationCallData]),
  })
  return address
}

function getInstallData(module: Module) {
  return getNexusInstallData(module)
}

async function packSignature(
  signature: Hex,
  validator: ValidatorConfig,
  transformSignature: (signature: Hex) => Hex = (signature) => signature,
) {
  return packNexusSignature(
    signature,
    validator,
    transformSignature,
    K1_DEFAULT_VALIDATOR_ADDRESS,
  )
}

async function getSmartAccount(
  client: PublicClient,
  address: Address,
  owners: OwnerSet,
  validatorAddress: Address,
  sign: (hash: Hex) => Promise<Hex>,
) {
  return getNexusSmartAccount(
    client,
    address,
    owners,
    validatorAddress,
    sign,
    K1_DEFAULT_VALIDATOR_ADDRESS,
  )
}

async function getSessionSmartAccount(
  client: PublicClient,
  address: Address,
  session: Session,
  validatorAddress: Address,
  enableData: EnableSessionData | null,
  sign: (hash: Hex) => Promise<Hex>,
) {
  return getNexusSessionSmartAccount(
    client,
    address,
    session,
    validatorAddress,
    enableData,
    sign,
    K1_DEFAULT_VALIDATOR_ADDRESS,
  )
}

async function getGuardianSmartAccount(
  client: PublicClient,
  address: Address,
  guardians: OwnerSet,
  validatorAddress: Address,
  sign: (hash: Hex) => Promise<Hex>,
) {
  return getNexusGuardianSmartAccount(
    client,
    address,
    guardians,
    validatorAddress,
    sign,
    K1_DEFAULT_VALIDATOR_ADDRESS,
  )
}

export {
  getInstallData,
  getAddress,
  packSignature,
  getDeployArgs,
  getSmartAccount,
  getSessionSmartAccount,
  getGuardianSmartAccount,
}
