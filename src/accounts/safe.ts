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
  encodeSmartSessionSignature,
  getMockSignature,
  getPermissionId,
  SMART_SESSION_MODE_ENABLE,
  SMART_SESSION_MODE_USE,
} from '../modules/validators'
import type { EnableSessionData } from '../modules/validators/smart-sessions'
import type { OwnerSet, RhinestoneAccountConfig, Session } from '../types'
import {
  AccountConfigurationNotSupportedError,
  Eip712DomainNotAvailableError,
  OwnersFieldRequiredError,
} from './error'
import { encode7579Calls, getAccountNonce, type ValidatorConfig } from './utils'

const SAFE_7579_LAUNCHPAD_ADDRESS: Address =
  '0x75798463024Bda64D83c94A64Bc7D7eaB41300eF'
const SAFE_7579_ADAPTER_ADDRESS: Address =
  '0x7579f2AD53b01c3D8779Fe17928e0D48885B0003'
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

    console.log('getDeployArgs 1', {
      factory: config.initData.factory,
      factoryData: config.initData.factoryData,
      salt,
      implementation,
      initializationCallData: null,
    })

    return {
      factory: config.initData.factory,
      factoryData: config.initData.factoryData,
      salt,
      implementation,
      initializationCallData: null,
    }
  }

  const initData = getInitData(config)

  const account = config.account
  const saltNonce = account?.type === 'safe' ? (account.nonce ?? 0n) : 0n
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

  console.log('getDeployArgs 2', {
    factory: SAFE_PROXY_FACTORY_ADDRESS,
    factoryData,
    salt,
    implementation: SAFE_SINGLETON_ADDRESS,
    initializationCallData: null,
  })

  return {
    factory: SAFE_PROXY_FACTORY_ADDRESS,
    factoryData,
    salt,
    implementation: SAFE_SINGLETON_ADDRESS,
    initializationCallData: null,
  }
}

function getInitData(config: RhinestoneAccountConfig) {
  const owners = getOwners(config)
  const threshold = getThreshold(config)
  const moduleSetup = getModuleSetup(config)
  const modules = [
    ...moduleSetup.validators,
    ...moduleSetup.executors,
    ...moduleSetup.fallbacks,
    ...moduleSetup.hooks,
  ]
  return encodeFunctionData({
    abi: parseAbi([
      'function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment, address paymentReceiver) external',
    ]),
    functionName: 'setup',
    args: [
      owners,
      threshold,
      SAFE_7579_LAUNCHPAD_ADDRESS,
      encodeFunctionData({
        abi: parseAbi([
          'struct ModuleInit {address module;bytes initData;uint256 moduleType}',
          'function addSafe7579(address safe7579,ModuleInit[] calldata modules,address[] calldata attesters,uint8 threshold) external',
        ]),
        functionName: 'addSafe7579',
        args: [
          SAFE_7579_ADAPTER_ADDRESS,
          modules.map((m) => ({
            module: m.address,
            initData: m.initData,
            moduleType: m.type,
          })),
          [],
          0,
        ],
      }),
      SAFE_7579_ADAPTER_ADDRESS,
      zeroAddress,
      BigInt(0),
      zeroAddress,
    ],
  })
}

function getAddress(config: RhinestoneAccountConfig) {
  const { factory, implementation, salt } = getDeployArgs(config)
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

async function getSessionSmartAccount(
  client: PublicClient,
  address: Address,
  session: Session,
  validatorAddress: Address,
  enableData: EnableSessionData | null,
  sign: (hash: Hex) => Promise<Hex>,
) {
  return await getBaseSmartAccount(
    address,
    client,
    validatorAddress,
    async () => {
      const dummyOpSignature = getMockSignature(session.owners)

      if (enableData) {
        return encodeSmartSessionSignature(
          SMART_SESSION_MODE_ENABLE,
          getPermissionId(session),
          dummyOpSignature,
          enableData,
        )
      }
      return encodeSmartSessionSignature(
        SMART_SESSION_MODE_USE,
        getPermissionId(session),
        dummyOpSignature,
      )
    },
    async (hash) => {
      const signature = await sign(hash)

      if (enableData) {
        return encodeSmartSessionSignature(
          SMART_SESSION_MODE_ENABLE,
          getPermissionId(session),
          signature,
          enableData,
        )
      }
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
  getSmartAccount,
  getSessionSmartAccount,
  getGuardianSmartAccount,
  getInitData,
}
