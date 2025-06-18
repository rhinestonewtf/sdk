import {
  type Abi,
  Account,
  type Address,
  concat,
  encodeFunctionData,
  encodePacked,
  type Hex,
  keccak256,
  type PublicClient,
  parseAbi,
  slice,
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

const SAFE_7579_LAUNCHPAD_ADDRESS: Address =
  '0x7579011aB74c46090561ea277Ba79D510c6C00ff'
const SAFE_7579_ADAPTER_ADDRESS: Address =
  '0x7579ee8307284f293b1927136486880611f20002'
const SAFE_SINGLETON_ADDRESS: Address =
  '0x29fcb43b46531bca003ddc8fcb67ffe91900c762'
const SAFE_PROXY_FACTORY_ADDRESS: Address =
  '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67'

const NO_SAFE_OWNER_ADDRESS: Address =
  '0xbabe99e62d8bcbd3acf5ccbcfcd4f64fe75e5e72'

function getDeployArgs(config: RhinestoneAccountConfig) {
  {
    const owners = getOwners(config)
    const threshold = getThreshold(config)
    const moduleSetup = getModuleSetup(config)
    const initData = encodeFunctionData({
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
            'struct ModuleInit {address module;bytes initData;}',
            'function addSafe7579(address safe7579,ModuleInit[] calldata validators,ModuleInit[] calldata executors,ModuleInit[] calldata fallbacks, ModuleInit[] calldata hooks,address[] calldata attesters,uint8 threshold) external',
          ]),
          functionName: 'addSafe7579',
          args: [
            SAFE_7579_ADAPTER_ADDRESS,
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
            moduleSetup.attesters,
            moduleSetup.threshold,
          ],
        }),
        SAFE_7579_ADAPTER_ADDRESS,
        zeroAddress,
        BigInt(0),
        zeroAddress,
      ],
    })

    const saltNonce = 0n
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
}

function getAddress(config: RhinestoneAccountConfig) {
  const hashedInitcode: Hex =
    '0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee'

  const { factory, salt } = getDeployArgs(config)
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

function get7702SmartAccount(): never {
  throw new Error('EIP-7702 is not supported for Safe accounts')
}

function get7702InitCalls(): never {
  throw new Error('EIP-7702 is not supported for Safe accounts')
}

function getOwners(config: RhinestoneAccountConfig) {
  const ownerSet = config.owners
  switch (ownerSet.type) {
    case 'ecdsa':
      return ownerSet.accounts.map((account) => account.address)
    case 'passkey':
      return [NO_SAFE_OWNER_ADDRESS]
  }
}

function getThreshold(config: RhinestoneAccountConfig) {
  const ownerSet = config.owners
  switch (ownerSet.type) {
    case 'ecdsa':
      return ownerSet.threshold ? BigInt(ownerSet.threshold) : 1n
    case 'passkey':
      return 1n
  }
}

export {
  getInstallData,
  getAddress,
  getPackedSignature,
  getDeployArgs,
  getSmartAccount,
  getSessionSmartAccount,
  getGuardianSmartAccount,
  get7702InitCalls,
  get7702SmartAccount,
}
