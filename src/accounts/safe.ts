import {
  type Abi,
  type Address,
  type Chain,
  concat,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  type Hex,
  keccak256,
  type PublicClient,
  parseAbi,
  parseAbiParameters,
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
import {
  getV0Attesters,
  getV0Setup as getV0ModuleSetup,
} from '../modules/legacy'
import { getMockSignature } from '../modules/validators'
import type { OwnerSet, RhinestoneAccountConfig, SafeAccount } from '../types'
import {
  AccountConfigurationNotSupportedError,
  Eip712DomainNotAvailableError,
  OwnersFieldRequiredError,
} from './error'
import { encode7579Calls, getAccountNonce, type ValidatorConfig } from './utils'

const SAFE_7579_LAUNCHPAD_V2_ADDRESS: Address =
  '0x75798463024bda64d83c94a64bc7d7eab41300ef'
const SAFE_7579_ADAPTER_V2_ADDRESS: Address =
  '0x7579f2ad53b01c3d8779fe17928e0d48885b0003'
const SAFE_7579_LAUNCHPAD_V1_ADDRESS: Address =
  '0x7579011ab74c46090561ea277ba79d510c6c00ff'
const SAFE_7579_ADAPTER_V1_ADDRESS: Address =
  '0x7579ee8307284f293b1927136486880611f20002'
const SAFE_SINGLETON_ADDRESS: Address =
  '0x29fcb43b46531bca003ddc8fcb67ffe91900c762'
const SAFE_PROXY_FACTORY_ADDRESS: Address =
  '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67'

const NO_SAFE_OWNER_ADDRESS: Address =
  '0xbabe99e62d8bcbd3acf5ccbcfcd4f64fe75e5e72'
const SAFE_PROXY_INIT_CODE =
  '0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564'

function getDeployArgs(config: RhinestoneAccountConfig) {
  if (config.initData) {
    if (!('factory' in config.initData)) {
      return null
    }
    const factoryData = decodeFunctionData({
      abi: parseAbi([
        'function createProxyWithNonce(address singleton,bytes calldata initializer,uint256 saltNonce) external payable returns (address)',
      ]),
      data: config.initData.factoryData,
    })
    if (factoryData.functionName !== 'createProxyWithNonce') {
      throw new AccountConfigurationNotSupportedError(
        'Invalid factory data',
        'safe',
      )
    }
    const implementation = factoryData.args[0]
    const initData = factoryData.args[1]
    const saltNonce = factoryData.args[2]
    const salt = keccak256(
      encodePacked(['bytes32', 'uint256'], [keccak256(initData), saltNonce]),
    )

    return {
      factory: config.initData.factory,
      factoryData: config.initData.factoryData,
      salt,
      implementation,
      initializationCallData: null,
    }
  }

  const owners = getOwners(config)
  const threshold = getThreshold(config)
  const moduleSetup = getModuleSetup(config)
  const modules = [
    ...moduleSetup.validators,
    ...moduleSetup.executors,
    ...moduleSetup.fallbacks,
    ...moduleSetup.hooks,
  ]
  const adapter = SAFE_7579_ADAPTER_V2_ADDRESS
  const launchpad = SAFE_7579_LAUNCHPAD_V2_ADDRESS
  const calldata = encodeFunctionData({
    abi: parseAbi([
      'struct ModuleInit {address module;bytes initData;uint256 moduleType}',
      'function addSafe7579(address safe7579,ModuleInit[] calldata modules,address[] calldata attesters,uint8 threshold) external',
    ]),
    functionName: 'addSafe7579',
    args: [
      adapter,
      modules.map((m) => ({
        module: m.address,
        initData: m.initData,
        moduleType: m.type,
      })),
      [],
      0,
    ],
  })
  const initData = encodeFunctionData({
    abi: parseAbi([
      'function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment, address paymentReceiver) external',
    ]),
    functionName: 'setup',
    args: [
      owners,
      threshold,
      launchpad,
      calldata,
      adapter,
      zeroAddress,
      BigInt(0),
      zeroAddress,
    ],
  })

  const account = config.account
  const saltNonce = (account as SafeAccount)?.nonce ?? 0n
  const factoryData = encodeFunctionData({
    abi: parseAbi([
      'function createProxyWithNonce(address singleton,bytes calldata initializer,uint256 saltNonce) external payable returns (address)',
    ]),
    functionName: 'createProxyWithNonce',
    args: [SAFE_SINGLETON_ADDRESS, initData, saltNonce],
  })

  const salt = keccak256(
    encodePacked(['bytes32', 'uint256'], [keccak256(initData), saltNonce]),
  )

  return {
    factory: SAFE_PROXY_FACTORY_ADDRESS,
    factoryData,
    salt,
    implementation: SAFE_SINGLETON_ADDRESS,
    initializationCallData: null,
  }
}

function getV0DeployArgs(config: RhinestoneAccountConfig) {
  if (config.initData) {
    throw new AccountConfigurationNotSupportedError(
      'Custom V0 accounts are not supported',
      'safe',
    )
  }

  const owners = getOwners(config)
  const threshold = getThreshold(config)
  const attesters = getV0Attesters()
  const moduleSetup = getV0ModuleSetup(config)
  const adapter = SAFE_7579_ADAPTER_V1_ADDRESS
  const launchpad = SAFE_7579_LAUNCHPAD_V1_ADDRESS
  const calldata = encodeFunctionData({
    abi: parseAbi([
      'struct ModuleInit {address module;bytes initData;}',
      'function addSafe7579(address safe7579,ModuleInit[] calldata validators,ModuleInit[] calldata executors,ModuleInit[] calldata fallbacks, ModuleInit[] calldata hooks,address[] calldata attesters,uint8 threshold) external',
    ]),
    functionName: 'addSafe7579',
    args: [
      adapter,
      moduleSetup.validators.map((v) => ({
        module: v.address,
        initData: v.initData,
      })),
      moduleSetup.executors.map((e) => ({
        module: e.address,
        initData: e.initData,
      })),
      moduleSetup.fallbacks.map((f) => ({
        module: f.address,
        initData: f.initData,
      })),
      moduleSetup.hooks.map((h) => ({
        module: h.address,
        initData: h.initData,
      })),
      attesters.addresses,
      attesters.threshold,
    ],
  })
  const initData = encodeFunctionData({
    abi: parseAbi([
      'function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment, address paymentReceiver) external',
    ]),
    functionName: 'setup',
    args: [
      owners,
      threshold,
      launchpad,
      calldata,
      adapter,
      zeroAddress,
      BigInt(0),
      zeroAddress,
    ],
  })

  const account = config.account
  const saltNonce = (account as SafeAccount)?.nonce ?? 0n
  const factoryData = encodeFunctionData({
    abi: parseAbi([
      'function createProxyWithNonce(address singleton,bytes calldata initializer,uint256 saltNonce) external payable returns (address)',
    ]),
    functionName: 'createProxyWithNonce',
    args: [SAFE_SINGLETON_ADDRESS, initData, saltNonce],
  })

  const salt = keccak256(
    encodePacked(['bytes32', 'uint256'], [keccak256(initData), saltNonce]),
  )

  return {
    factory: SAFE_PROXY_FACTORY_ADDRESS,
    factoryData,
    salt,
    implementation: SAFE_SINGLETON_ADDRESS,
    initializationCallData: null,
  }
}

function getAddress(config: RhinestoneAccountConfig) {
  const deployArgs = getDeployArgs(config)
  if (!deployArgs) {
    throw new Error('Cannot derive address: deploy args not available')
  }
  const { factory, implementation, salt } = deployArgs
  const constructorArgs = encodeAbiParameters(
    parseAbiParameters('address singleton'),
    [implementation],
  )
  const address = getContractAddress({
    opcode: 'CREATE2',
    from: factory,
    salt,
    bytecode: concat([SAFE_PROXY_INIT_CODE, constructorArgs]),
  })
  return address
}

function getEip712Domain(config: RhinestoneAccountConfig, chain: Chain) {
  if (config.initData) {
    throw new Eip712DomainNotAvailableError(
      'Existing Safe-7579 accounts are not yet supported',
    )
  }
  return {
    name: 'rhinestone safe7579',
    version: 'v1.0.0',
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

async function packSignature(
  signature: Hex,
  validator: ValidatorConfig,
  transformSignature: (signature: Hex) => Hex = (signature) => signature,
) {
  return encodePacked(
    ['address', 'bytes'],
    [validator.address, transformSignature(signature)],
  )
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

async function getBaseSmartAccount(
  address: Address,
  client: PublicClient,
  validatorAddress: Address,
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
      const key = concat([validatorAddress, '0x00000000'])
      const nonce = await getAccountNonce(client, {
        address,
        entryPointAddress: entryPoint07Address,
        key: BigInt(key),
      })
      return nonce
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

function getOwners(config: RhinestoneAccountConfig) {
  if (!config.owners) {
    throw new OwnersFieldRequiredError()
  }
  const ownerSet = config.owners
  switch (ownerSet.type) {
    case 'ecdsa':
    case 'ens':
      return ownerSet.accounts.map((account) => account.address)
    case 'passkey':
      return [NO_SAFE_OWNER_ADDRESS]
    case 'multi-factor':
      return [NO_SAFE_OWNER_ADDRESS]
  }
}

function getThreshold(config: RhinestoneAccountConfig) {
  if (!config.owners) {
    throw new OwnersFieldRequiredError()
  }
  const ownerSet = config.owners
  switch (ownerSet.type) {
    case 'ecdsa':
    case 'ens':
      return ownerSet.threshold ? BigInt(ownerSet.threshold) : 1n
    case 'passkey':
      return 1n
    case 'multi-factor':
      return 1n
  }
}

export {
  getEip712Domain,
  getInstallData,
  getAddress,
  packSignature,
  getDeployArgs,
  getV0DeployArgs,
  getSmartAccount,
  getGuardianSmartAccount,
}
