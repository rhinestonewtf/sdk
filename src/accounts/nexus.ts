import type { Abi, Account, Address, Hex, PublicClient } from 'viem'
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  keccak256,
  parseAbi,
  slice,
  toHex,
  zeroAddress,
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
import { Module } from '../modules/common'
import {
  encodeSmartSessionSignature,
  getMockSignature,
  getPermissionId,
  SMART_SESSION_MODE_USE,
} from '../modules/validators'
import type { OwnerSet, RhinestoneAccountConfig, Session } from '../types'
import { encode7579Calls, getAccountNonce, ValidatorConfig } from './utils'

const NEXUS_IMPLEMENTATION_ADDRESS: Address =
  '0x000000004f43c49e93c970e84001853a70923b03'
const NEXUS_FACTORY_ADDRESS: Address =
  '0x000000001D1D5004a02bAfAb9de2D6CE5b7B13de'
const NEXUS_BOOTSTRAP_ADDRESS: Address =
  '0x00000000D3254452a909E4eeD47455Af7E27C289'

const K1_MEE_VALIDATOR_ADDRESS = '0x00000000d12897ddadc2044614a9677b191a2d95'

const NEXUS_CREATION_CODE =
  '0x60806040526102aa803803806100148161018c565b92833981016040828203126101885781516001600160a01b03811692909190838303610188576020810151906001600160401b03821161018857019281601f8501121561018857835161006e610069826101c5565b61018c565b9481865260208601936020838301011161018857815f926020809301865e8601015260017f90b772c2cb8a51aa7a8a65fc23543c6d022d5b3f8e2b92eed79fba7eef8293005d823b15610176577f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc80546001600160a01b031916821790557fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b5f80a282511561015e575f8091610146945190845af43d15610156573d91610137610069846101c5565b9283523d5f602085013e6101e0565b505b604051606b908161023f8239f35b6060916101e0565b50505034156101485763b398979f60e01b5f5260045ffd5b634c9c8ce360e01b5f5260045260245ffd5b5f80fd5b6040519190601f01601f191682016001600160401b038111838210176101b157604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b0381116101b157601f01601f191660200190565b9061020457508051156101f557805190602001fd5b63d6bda27560e01b5f5260045ffd5b81511580610235575b610215575090565b639996b31560e01b5f9081526001600160a01b0391909116600452602490fd5b50803b1561020d56fe60806040523615605c575f8073ffffffffffffffffffffffffffffffffffffffff7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc5416368280378136915af43d5f803e156058573d5ff35b3d5ffd5b00fea164736f6c634300081b000a'

function getDeployArgs(config: RhinestoneAccountConfig) {
  const salt = keccak256('0x')
  const moduleSetup = getModuleSetup(config)
  const initData = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [
      NEXUS_BOOTSTRAP_ADDRESS,
      encodeFunctionData({
        abi: parseAbi([
          'struct BootstrapConfig {address module;bytes initData;}',
          'struct BootstrapPreValidationHookConfig {uint256 hookType;address module;bytes data;}',
          'struct RegistryConfig {address registry;address[] attesters;uint8 threshold;}',
          'function initNexus(BootstrapConfig[] calldata validators,BootstrapConfig[] calldata executors,BootstrapConfig calldata hook,BootstrapConfig[] calldata fallbacks,BootstrapPreValidationHookConfig[] calldata preValidationHooks,RegistryConfig registryConfig) external',
        ]),
        functionName: 'initNexus',
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
          {
            registry: moduleSetup.registry,
            attesters: moduleSetup.attesters,
            threshold: moduleSetup.threshold,
          },
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
    factory: NEXUS_FACTORY_ADDRESS,
    factoryData,
    salt,
    implementation: NEXUS_IMPLEMENTATION_ADDRESS,
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
    [NEXUS_IMPLEMENTATION_ADDRESS, initializationCallData],
  )
  const hashedInitcode: Hex = keccak256(
    concat([NEXUS_CREATION_CODE, accountInitData]),
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

async function getPackedSignature(
  signFn: (message: Hex) => Promise<Hex>,
  hash: Hex,
  validator: ValidatorConfig,
  transformSignature: (signature: Hex) => Hex = (signature) => signature,
) {
  const signature = await signFn(hash)
  const packedSig = encodePacked(
    ['address', 'bytes'],
    [validator.address, transformSignature(signature)],
  )
  return packedSig
}

async function getSmartAccount(
  client: PublicClient,
  address: Address,
  owners: OwnerSet,
  validatorAddress: Address,
  sign: (hash: Hex) => Promise<Hex>,
) {
  return getBaseSmartAccount(
    address,
    client,
    validatorAddress,
    async () => {
      return getMockSignature(owners)
    },
    sign,
  )
}

async function getSessionSmartAccount(
  client: PublicClient,
  address: Address,
  session: Session,
  validatorAddress: Address,
  sign: (hash: Hex) => Promise<Hex>,
) {
  return await getBaseSmartAccount(
    address,
    client,
    validatorAddress,
    async () => {
      const dummyOpSignature = getMockSignature(session.owners)
      return encodeSmartSessionSignature(
        SMART_SESSION_MODE_USE,
        getPermissionId(session),
        dummyOpSignature,
      )
    },
    async (hash) => {
      const signature = await sign(hash)
      return encodeSmartSessionSignature(
        SMART_SESSION_MODE_USE,
        getPermissionId(session),
        signature,
      )
    },
  )
}

async function getGuardianSmartAccount(
  client: PublicClient,
  address: Address,
  guardians: OwnerSet,
  validatorAddress: Address,
  sign: (hash: Hex) => Promise<Hex>,
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
  )
}

async function get7702SmartAccount(account: Account, client: PublicClient) {
  return await getBaseSmartAccount(
    account.address,
    client,
    zeroAddress,
    async () => {
      const dynamicPart = K1_MEE_VALIDATOR_ADDRESS.substring(2).padEnd(40, '0')
      return `0x0000000000000000000000000000000000000000000000000000000000000040000000000000000000000000${dynamicPart}000000000000000000000000000000000000000000000000000000000000004181d4b4981670cb18f99f0b4a66446df1bf5b204d24cfcb659bf38ba27a4359b5711649ec2423c5e1247245eba2964679b6a1dbb85c992ae40b9b00c6935b02ff1b00000000000000000000000000000000000000000000000000000000000000` as Hex
    },
    async (hash) => {
      if (!account.signMessage) {
        throw new Error('Sign message not supported by account')
      }
      return await account.signMessage({
        message: { raw: hash as Hex },
      })
    },
  )
}

async function getBaseSmartAccount(
  address: Address,
  client: PublicClient,
  nonceValidatorAddress: Address,
  getStubSignature: () => Promise<Hex>,
  signUserOperation: (hash: Hex) => Promise<Hex>,
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
      const TIMESTAMP_ADJUSTMENT = 16777215n // max value for size 3
      const defaultedKey = (args?.key ?? 0n) % TIMESTAMP_ADJUSTMENT
      const defaultedValidationMode = '0x00'
      const key = concat([
        toHex(defaultedKey, { size: 3 }),
        defaultedValidationMode,
        nonceValidatorAddress,
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
          signature: '0x',
        },
        entryPointAddress: entryPoint07Address,
        entryPointVersion: '0.7',
        chainId: chainId,
      })
      return await signUserOperation(hash)
    },
  })
}

function get7702InitCalls(config: RhinestoneAccountConfig) {
  const eoa = config.eoa
  if (!eoa) {
    throw new Error('EIP-7702 accounts must have an EOA account')
  }

  const moduleSetup = getModuleSetup(config)
  return [
    {
      to: eoa.address,
      data: encodeFunctionData({
        abi: parseAbi([
          'function setRegistry(address newRegistry, address[] calldata attesters, uint8 threshold)',
        ]),
        functionName: 'setRegistry',
        args: [
          moduleSetup.registry,
          moduleSetup.attesters,
          moduleSetup.threshold,
        ],
      }),
    },
    ...moduleSetup.validators.map((validator) => ({
      to: eoa.address,
      data: encodeFunctionData({
        abi: parseAbi([
          'function installModule(uint256 moduleTypeId, address module, bytes calldata initData)',
        ]),
        functionName: 'installModule',
        args: [validator.type, validator.address, validator.initData],
      }),
    })),
    ...moduleSetup.executors.map((executor) => ({
      to: eoa.address,
      data: encodeFunctionData({
        abi: parseAbi([
          'function installModule(uint256 moduleTypeId, address module, bytes calldata initData)',
        ]),
        functionName: 'installModule',
        args: [executor.type, executor.address, executor.initData],
      }),
    })),
    ...moduleSetup.fallbacks.map((fallback) => ({
      to: eoa.address,
      data: encodeFunctionData({
        abi: parseAbi([
          'function installModule(uint256 moduleTypeId, address module, bytes calldata initData)',
        ]),
        functionName: 'installModule',
        args: [fallback.type, fallback.address, fallback.initData],
      }),
    })),
  ]
}

export {
  getInstallData,
  getAddress,
  getPackedSignature,
  getDeployArgs,
  getSmartAccount,
  getSessionSmartAccount,
  getGuardianSmartAccount,
  get7702SmartAccount,
  get7702InitCalls,
}
