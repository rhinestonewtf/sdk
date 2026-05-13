import type { Address, Chain, Hex, PublicClient } from 'viem'
import {
  concat,
  decodeFunctionData,
  encodeFunctionData,
  encodePacked,
  keccak256,
  pad,
  parseAbi,
  slice,
  zeroHash,
} from 'viem'
import type { Module } from '../modules/common'
import { ENS_HCA_MODULE, getOwnerValidator } from '../modules/validators/core'
import type { OwnerSet, RhinestoneAccountConfig } from '../types'
import {
  AccountConfigurationNotSupportedError,
  Eip712DomainNotAvailableError,
} from './error'
import {
  getGuardianSmartAccount as getNexusGuardianSmartAccount,
  getInstallData as getNexusInstallData,
  getSmartAccount as getNexusSmartAccount,
  packSignature as packNexusSignature,
} from './nexus'
import type { ValidatorConfig } from './utils'

const HCA_IMPLEMENTATION_ADDRESS: Address =
  '0x04eEd1aA7555C36d26a88E3566A802B6E311B3ac'
const HCA_FACTORY_ADDRESS: Address =
  '0x9B5FC82012ea7a306c33246164672e12CC2E52f9'

const HCA_VERSION = '1.0.0'

// Solady CREATE3 proxy bytecode hash
const CREATE3_PROXY_HASH: Hex =
  '0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f'

function getDeployArgs(config: RhinestoneAccountConfig) {
  if (config.initData) {
    if (!('factory' in config.initData)) {
      return null
    }
    const { factory, factoryData } = config.initData
    try {
      const decoded = decodeFunctionData({
        abi: parseAbi(['function createAccount(bytes)']),
        data: factoryData,
      })
      const moduleInitData = decoded.args[0]
      const initializationCallData = encodeFunctionData({
        abi: parseAbi(['function initializeAccount(bytes)']),
        functionName: 'initializeAccount',
        args: [moduleInitData],
      })
      return {
        factory,
        factoryData,
        salt: zeroHash,
        implementation: HCA_IMPLEMENTATION_ADDRESS,
        initializationCallData,
      }
    } catch {
      return null
    }
  }

  if (!config.owners || config.owners.type !== 'ens') {
    throw new AccountConfigurationNotSupportedError(
      'HCA accounts require ENS owners with ownerExpirations',
      'hca',
    )
  }

  const ownerValidator = getOwnerValidator(config)
  const moduleInitData = ownerValidator.initData

  // Factory takes module initData directly: abi.encode(threshold, owners[])
  // It internally calls module.getOwnerFromInitData(initData) to derive the CREATE3 salt,
  // then deploys the proxy with the stored implementation
  const factoryData = encodeFunctionData({
    abi: parseAbi(['function createAccount(bytes)']),
    functionName: 'createAccount',
    args: [moduleInitData],
  })

  const initializationCallData = encodeFunctionData({
    abi: parseAbi(['function initializeAccount(bytes)']),
    functionName: 'initializeAccount',
    args: [moduleInitData],
  })

  return {
    factory: HCA_FACTORY_ADDRESS,
    factoryData,
    salt: zeroHash,
    implementation: HCA_IMPLEMENTATION_ADDRESS,
    initializationCallData,
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

  if (config.initData?.address) {
    return config.initData.address
  }

  if (!config.owners || config.owners.type !== 'ens') {
    throw new Error('Cannot derive HCA address without ENS owners')
  }

  // Primary owner is the first account
  const primaryOwner = config.owners.accounts[0].address

  return predictCreate3Address(HCA_FACTORY_ADDRESS, primaryOwner)
}

// Solady CREATE3 address derivation:
// 1. salt = bytes32(bytes20(primaryOwner)) — right-padded
// 2. proxy = CREATE2(factory, salt, CREATE3_PROXY_HASH)
// 3. account = CREATE(proxy, nonce=1) = keccak256(0xd694 ++ proxy ++ 0x01)
function predictCreate3Address(
  factory: Address,
  primaryOwner: Address,
): Address {
  // salt = bytes32(bytes20(owner)) — address right-padded to 32 bytes
  const salt = pad(primaryOwner as Hex, { size: 32, dir: 'right' })

  // CREATE2: proxy address
  const proxyHash = keccak256(
    encodePacked(
      ['bytes1', 'address', 'bytes32', 'bytes32'],
      ['0xff', factory, salt, CREATE3_PROXY_HASH],
    ),
  )
  const proxyAddress = slice(proxyHash, 12, 32)

  // CREATE with nonce 1: RLP([proxy, 1]) = 0xd694 ++ proxy ++ 0x01
  const accountHash = keccak256(concat(['0xd694', proxyAddress, '0x01']))
  return slice(accountHash, 12, 32)
}

function getEip712Domain(config: RhinestoneAccountConfig, chain: Chain) {
  if (config.initData) {
    throw new Eip712DomainNotAvailableError(
      'Existing HCA accounts are not yet supported',
    )
  }
  return {
    name: 'Nexus',
    version: HCA_VERSION,
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
    ENS_HCA_MODULE,
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
    ENS_HCA_MODULE,
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
    ENS_HCA_MODULE,
  )
}

export {
  ENS_HCA_MODULE,
  getEip712Domain,
  getInstallData,
  getAddress,
  packSignature,
  getDeployArgs,
  getSmartAccount,
  getGuardianSmartAccount,
}
