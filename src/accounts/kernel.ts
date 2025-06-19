import {
  Abi,
  Address,
  concat,
  concatHex,
  decodeAbiParameters,
  domainSeparator,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  Hex,
  keccak256,
  PublicClient,
  parseAbi,
  stringToHex,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem'
import {
  entryPoint07Abi,
  entryPoint07Address,
  getUserOperationHash,
  SmartAccount,
  SmartAccountImplementation,
  toSmartAccount,
} from 'viem/account-abstraction'

import { getSetup as getModuleSetup } from '../modules'
import {
  MODULE_TYPE_ID_EXECUTOR,
  MODULE_TYPE_ID_FALLBACK,
  MODULE_TYPE_ID_HOOK,
  MODULE_TYPE_ID_VALIDATOR,
  Module,
} from '../modules/common'
import {
  encodeSmartSessionSignature,
  getMockSignature,
  getPermissionId,
  SMART_SESSION_MODE_USE,
} from '../modules/validators'
import { OwnerSet, RhinestoneAccountConfig, Session } from '../types'
import { encode7579Calls, getAccountNonce, ValidatorConfig } from './utils'

type ValidatorType = 'root' | 'validator'

const KERNEL_META_FACTORY_ADDRESS: Address =
  '0xd703aae79538628d27099b8c4f621be4ccd142d5'
const KERNEL_IMPLEMENTATION_ADDRESS: Address =
  '0xd6CEDDe84be40893d153Be9d467CD6aD37875b28'
const KERNEL_FACTORY_ADDRESS: Address =
  '0x2577507b78c2008ff367261cb6285d44ba5ef2e9'

const KERNEL_BYTECODE =
  '0x603d3d8160223d3973d6cedde84be40893d153be9d467cd6ad37875b2860095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3'

const KERNEL_VERSION = '0.3.3'

function getDeployArgs(config: RhinestoneAccountConfig) {
  const salt = zeroHash
  const moduleSetup = getModuleSetup(config)

  const rootValidator = concat(['0x01', moduleSetup.validators[0].address])
  const hook = zeroAddress
  const validatorData = moduleSetup.validators[0].initData
  const hookData = '0x'

  // Install modules via init config
  const spareValidators = moduleSetup.validators.slice(1)
  const initConfig: Hex[] = []
  for (const module of spareValidators) {
    initConfig.push(...getInstallData(module))
  }
  for (const module of moduleSetup.executors) {
    initConfig.push(...getInstallData(module))
  }
  for (const module of moduleSetup.fallbacks) {
    initConfig.push(...getInstallData(module))
  }
  for (const module of moduleSetup.hooks) {
    initConfig.push(...getInstallData(module))
  }

  const initializationCallData = encodeFunctionData({
    abi: parseAbi(['function initialize(bytes21,address,bytes,bytes,bytes[])']),
    functionName: 'initialize',
    args: [rootValidator, hook, validatorData, hookData, initConfig],
  })

  const factoryData = encodeFunctionData({
    abi: parseAbi(['function deployWithFactory(address,bytes,bytes32)']),
    functionName: 'deployWithFactory',
    args: [KERNEL_FACTORY_ADDRESS, initializationCallData, salt],
  })

  return {
    factory: KERNEL_META_FACTORY_ADDRESS,
    factoryData,
    salt,
    implementation: KERNEL_IMPLEMENTATION_ADDRESS,
    initializationCallData,
  }
}

function getAddress(config: RhinestoneAccountConfig) {
  const { salt, initializationCallData } = getDeployArgs(config)
  const actualSalt = keccak256(concat([initializationCallData, salt]))
  return getContractAddress({
    from: KERNEL_FACTORY_ADDRESS,
    opcode: 'CREATE2',
    bytecode: KERNEL_BYTECODE,
    salt: actualSalt,
  })
}

function getInstallData(module: Module): Hex[] {
  const HOOK_INSTALLED_ADDRESS = '0x0000000000000000000000000000000000000001'

  switch (module.type) {
    case MODULE_TYPE_ID_VALIDATOR: {
      const data = encodeAbiParameters(
        [{ type: 'bytes' }, { type: 'bytes' }, { type: 'bytes' }],
        [module.initData, '0x', '0x'],
      )
      const initData = concat([HOOK_INSTALLED_ADDRESS, data])
      const validatorId = concat(['0x01', module.address])
      return [
        encodeFunctionData({
          abi: parseAbi(['function installModule(uint256,address,bytes)']),
          functionName: 'installModule',
          args: [module.type, module.address, initData],
        }),
        encodeFunctionData({
          abi: parseAbi(['function grantAccess(bytes21,bytes4,bool)']),
          functionName: 'grantAccess',
          args: [validatorId, '0xe9ae5c53', true],
        }),
      ]
    }
    case MODULE_TYPE_ID_EXECUTOR: {
      const data = encodeAbiParameters(
        [{ type: 'bytes' }, { type: 'bytes' }],
        [module.initData, '0x'],
      )
      const initData = concat([zeroAddress, data])
      return [
        encodeFunctionData({
          abi: parseAbi(['function installModule(uint256,address,bytes)']),
          functionName: 'installModule',
          args: [module.type, module.address, initData],
        }),
      ]
    }
    case MODULE_TYPE_ID_FALLBACK: {
      const [selector, flags, selectorData] = decodeAbiParameters(
        [
          { name: 'selector', type: 'bytes4' },
          { name: 'flags', type: 'bytes1' },
          { name: 'data', type: 'bytes' },
        ],
        module.initData,
      )
      const data = encodeAbiParameters(
        [{ type: 'bytes' }, { type: 'bytes' }],
        [concat([flags, selectorData]), '0x'],
      )
      const initData = concat([selector, HOOK_INSTALLED_ADDRESS, data])
      return [
        encodeFunctionData({
          abi: parseAbi(['function installModule(uint256,address,bytes)']),
          functionName: 'installModule',
          args: [module.type, module.address, initData],
        }),
      ]
    }
    case MODULE_TYPE_ID_HOOK: {
      return [
        encodeFunctionData({
          abi: parseAbi(['function installModule(uint256,address,bytes)']),
          functionName: 'installModule',
          args: [module.type, module.address, module.initData],
        }),
      ]
    }
  }
}

function get7702InitCalls(): never {
  throw new Error('EIP-7702 is not yet supported for Kernel accounts')
}

function get7702SmartAccount(): never {
  throw new Error('EIP-7702 is not yet supported for Kernel accounts')
}

async function getPackedSignature(
  signFn: (message: Hex) => Promise<Hex>,
  hash: Hex,
  validator: ValidatorConfig,
  accountAddress: Address,
  transformSignature: (signature: Hex) => Hex = (signature) => signature,
) {
  const vId = validator.isRoot ? '0x00' : concat(['0x01', validator.address])
  const signature = validator.isRoot
    ? await signFn(wrapMessageHash(hash, accountAddress))
    : await signFn(hash)
  const magicValueSigReplayable = keccak256(
    toHex('kernel.replayable.signature'),
  )
  const packedSig = concat([
    vId,
    magicValueSigReplayable,
    transformSignature(signature),
  ])
  return packedSig
}

function wrapMessageHash(messageHash: Hex, accountAddress: Hex): Hex {
  const _domainSeparator = domainSeparator({
    domain: {
      name: 'Kernel',
      version: KERNEL_VERSION,
      chainId: 0,
      verifyingContract: accountAddress,
    },
  })
  const kernelTypeHash = keccak256(stringToHex('Kernel(bytes32 hash)'))
  const wrappedMessageHash = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }],
      [kernelTypeHash, messageHash],
    ),
  )
  const digest = keccak256(
    concatHex(['0x1901', _domainSeparator, wrappedMessageHash]),
  )
  return digest
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
    'root',
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
    'validator',
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
    'validator',
    async () => {
      return getMockSignature(guardians)
    },
    async (hash) => {
      return await sign(hash)
    },
  )
}

async function getBaseSmartAccount(
  address: Address,
  client: PublicClient,
  validatorAddress: Address,
  validatorType: ValidatorType,
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
    async getNonce() {
      // Default mode
      const mode = '0x00'
      const type = validatorType === 'root' ? '0x00' : '0x01'
      const identifier = validatorAddress
      const nonceKey = '0x0000'
      const key = concat([mode, type, identifier, nonceKey])
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

export {
  getInstallData,
  getAddress,
  getDeployArgs,
  getSmartAccount,
  getSessionSmartAccount,
  getGuardianSmartAccount,
  get7702InitCalls,
  get7702SmartAccount,
  getPackedSignature,
}
