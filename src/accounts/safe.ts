import {
  Address,
  encodeFunctionData,
  encodePacked,
  Hex,
  keccak256,
  parseAbi,
  zeroAddress,
} from 'viem'

import { getSetup as getModuleSetup } from '../modules'
import { RhinestoneAccountConfig } from '../types'

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

async function getDeployArgs(config: RhinestoneAccountConfig) {
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

    const hashedInitcode: Hex =
      '0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee'

    return {
      factory: SAFE_PROXY_FACTORY_ADDRESS,
      factoryData,
      salt,
      hashedInitcode,
      implementation: SAFE_SINGLETON_ADDRESS,
      initializationCallData: null,
    }
  }
}

function get7702InitCalls(): never {
  throw new Error('EIP-7702 is not supported for Safe accounts')
}

function get7702SmartAccount(): never {
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

export { getDeployArgs, get7702InitCalls, get7702SmartAccount }
