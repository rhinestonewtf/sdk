import type { Address, Chain, Hex, PublicClient } from 'viem'
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  keccak256,
  parseAbi,
  slice,
  zeroAddress,
  zeroHash,
} from 'viem'
import { getSetup as getModuleSetup } from '../modules'
import type { Module } from '../modules/common'
import type { EnableSessionData } from '../modules/validators/smart-sessions'
import type {
  OwnerSet,
  RhinestoneAccountConfig,
  Session,
  StartaleAccount,
} from '../types'
import { Eip712DomainNotAvailableError } from './error'
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
const STARTALE_VERSION = '1.0.0'

const IMPLEMENTATION_ADDRESS: Address =
  '0x000000b8f5f723a680d3d7ee624fe0bc84a6e05a'
const FACTORY_ADDRESS: Address = '0x0000003B3E7b530b4f981aE80d9350392Defef90'
const BOOTSTRAP_ADDRESS: Address = '0x000000552A5fAe3Db7a8F3917C435448F49BA6a9'

const CREATION_CODE =
  '0x608060405261029d803803806100148161018c565b92833981016040828203126101885781516001600160a01b03811692909190838303610188576020810151906001600160401b03821161018857019281601f8501121561018857835161006e610069826101c5565b61018c565b9481865260208601936020838301011161018857815f926020809301865e8601015260017f754fd8b321c4649cb777ae6fdce7e89e9cceaa31a4f639795c7807eb7f1a27005d823b15610176577f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc80546001600160a01b031916821790557fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b5f80a282511561015e575f8091610146945190845af43d15610156573d91610137610069846101c5565b9283523d5f602085013e6101e0565b505b604051605e908161023f8239f35b6060916101e0565b50505034156101485763b398979f60e01b5f5260045ffd5b634c9c8ce360e01b5f5260045260245ffd5b5f80fd5b6040519190601f01601f191682016001600160401b038111838210176101b157604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b0381116101b157601f01601f191660200190565b9061020457508051156101f557805190602001fd5b63d6bda27560e01b5f5260045ffd5b81511580610235575b610215575090565b639996b31560e01b5f9081526001600160a01b0391909116600452602490fd5b50803b1561020d56fe60806040523615605c575f8073ffffffffffffffffffffffffffffffffffffffff7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc5416368280378136915af43d5f803e156058573d5ff35b3d5ffd5b00'

function getDeployArgs(config: RhinestoneAccountConfig) {
  const account = config.account
  const salt = (account as StartaleAccount)?.salt ?? zeroHash
  const moduleSetup = getModuleSetup(config)
  const initData = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [
      BOOTSTRAP_ADDRESS,
      encodeFunctionData({
        abi: parseAbi([
          'struct BootstrapConfig {address module;bytes initData;}',
          'struct BootstrapPreValidationHookConfig {uint256 hookType;address module;bytes data;}',
          'function init(BootstrapConfig[] calldata validators,BootstrapConfig[] calldata executors,BootstrapConfig calldata hook,BootstrapConfig[] calldata fallbacks,BootstrapPreValidationHookConfig[] calldata preValidationHooks) external',
        ]),
        functionName: 'init',
        args: [
          moduleSetup.validators.map((v) => ({
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
      }),
    ],
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
    factory: FACTORY_ADDRESS,
    factoryData,
    salt,
    implementation: IMPLEMENTATION_ADDRESS,
    initializationCallData,
  }
}

function getAddress(config: RhinestoneAccountConfig) {
  const { factory, salt, initializationCallData } = getDeployArgs(config)

  const accountInitData = encodeAbiParameters(
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
    [IMPLEMENTATION_ADDRESS, initializationCallData],
  )
  const hashedInitcode: Hex = keccak256(
    concat([CREATION_CODE, accountInitData]),
  )

  const hash = keccak256(
    encodePacked(
      ['bytes1', 'address', 'bytes32', 'bytes'],
      ['0xff', factory, salt, hashedInitcode],
    ),
  )
  const address = slice(hash, 12, 32)
  return address
}

function getEip712Domain(config: RhinestoneAccountConfig, chain: Chain) {
  if (config.initData) {
    throw new Eip712DomainNotAvailableError(
      'Existing Startale accounts are not yet supported',
    )
  }
  return {
    name: 'Startale',
    version: STARTALE_VERSION,
    chainId: chain.id,
    verifyingContract: getAddress(config),
    salt: zeroHash,
  }
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
  getEip712Domain,
  getInstallData,
  getAddress,
  packSignature,
  getDeployArgs,
  getSmartAccount,
  getSessionSmartAccount,
  getGuardianSmartAccount,
}
