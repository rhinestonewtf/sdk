import {
  type Address,
  concat,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  type Hex,
  keccak256,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
} from 'viem'
import { getV0Attesters } from '../../modules/legacy-core'
import type { AccountAdapter } from '../adapter'
import { type DeploymentMaterial, deploymentPlan } from '../deployment'
import { encodeErc7579Calls } from '../erc7579-calls'
import type { AccountConstruction } from '../types'
import {
  encodeAddressEnvelope,
  encodeInstallModule,
  encodeUninstallModule,
  primaryOwnerAddresses,
  primaryThreshold,
} from './shared'

const SAFE_LAUNCHPAD = '0x75798463024bda64d83c94a64bc7d7eab41300ef' as const
const SAFE_ADAPTER = '0x7579f2ad53b01c3d8779fe17928e0d48885b0003' as const
const SAFE_V0_LAUNCHPAD = '0x7579011ab74c46090561ea277ba79d510c6c00ff' as const
const SAFE_V0_ADAPTER = '0x7579ee8307284f293b1927136486880611f20002' as const
const SAFE_SINGLETON = '0x29fcb43b46531bca003ddc8fcb67ffe91900c762' as const
const SAFE_FACTORY = '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67' as const
const SAFE_PROXY_INIT_CODE =
  '0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564' as const

function safeMaterial(input: AccountConstruction): DeploymentMaterial {
  if (input.account.kind !== 'safe') throw new Error('Expected Safe account')
  if (input.eoa) return { address: input.eoa.address }
  if (input.initData && !('factory' in input.initData)) {
    return { address: input.initData.address }
  }
  let factory: Address = SAFE_FACTORY
  let factoryData: Hex
  let implementation: Address = SAFE_SINGLETON
  let salt: Hex
  if (input.initData && 'factory' in input.initData) {
    const decoded = decodeFunctionData({
      abi: parseAbi([
        'function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce)',
      ]),
      data: input.initData.factoryData,
    })
    if (decoded.functionName !== 'createProxyWithNonce') {
      throw new Error('Invalid Safe factory data')
    }
    factory = input.initData.factory
    factoryData = input.initData.factoryData
    implementation = decoded.args[0]
    salt = keccak256(
      encodePacked(
        ['bytes32', 'uint256'],
        [keccak256(decoded.args[1]), decoded.args[2]],
      ),
    )
  } else {
    if (!input.owner) throw new Error('Safe account owners are required')
    const modules = [
      ...input.setup.validators,
      ...input.setup.executors,
      ...input.setup.fallbacks,
      ...input.setup.hooks,
    ]
    const addSafe7579 = encodeFunctionData({
      abi: parseAbi([
        'struct ModuleInit {address module;bytes initData;uint256 moduleType}',
        'function addSafe7579(address safe7579,ModuleInit[] modules,address[] attesters,uint8 threshold)',
      ]),
      functionName: 'addSafe7579',
      args: [
        SAFE_ADAPTER,
        modules.map((module) => ({
          module: module.address,
          initData: module.initData,
          moduleType:
            module.kind === 'validator'
              ? 1n
              : module.kind === 'executor'
                ? 2n
                : module.kind === 'fallback'
                  ? 3n
                  : 4n,
        })),
        [],
        0,
      ],
    })
    const initializer = encodeFunctionData({
      abi: parseAbi([
        'function setup(address[] _owners,uint256 _threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)',
      ]),
      functionName: 'setup',
      args: [
        [...primaryOwnerAddresses(input.owner)],
        primaryThreshold(input.owner),
        SAFE_LAUNCHPAD,
        addSafe7579,
        SAFE_ADAPTER,
        zeroAddress,
        0n,
        zeroAddress,
      ],
    })
    const nonce =
      input.account.nonce.source === 'explicit' ? input.account.nonce.value : 0n
    factoryData = encodeFunctionData({
      abi: parseAbi([
        'function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce)',
      ]),
      functionName: 'createProxyWithNonce',
      args: [SAFE_SINGLETON, initializer, nonce],
    })
    salt = keccak256(
      encodePacked(['bytes32', 'uint256'], [keccak256(initializer), nonce]),
    )
  }
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
  return { address, factory, factoryData }
}

export function safeV0FactoryMaterial(
  input: AccountConstruction,
): Pick<Required<DeploymentMaterial>, 'factory' | 'factoryData'> {
  if (input.account.kind !== 'safe') throw new Error('Expected Safe account')
  if (input.initData) {
    throw new Error(
      'Account configuration for Safe account is not supported: Custom V0 accounts are not supported',
    )
  }
  if (!input.owner) throw new Error('Safe account owners are required')
  const attesters = getV0Attesters()
  const modules = (items: typeof input.setup.validators) =>
    items.map((module) => ({
      module: module.address,
      initData: module.initData,
    }))
  const addSafe7579 = encodeFunctionData({
    abi: parseAbi([
      'struct ModuleInit {address module;bytes initData;}',
      'function addSafe7579(address safe7579,ModuleInit[] validators,ModuleInit[] executors,ModuleInit[] fallbacks,ModuleInit[] hooks,address[] attesters,uint8 threshold)',
    ]),
    functionName: 'addSafe7579',
    args: [
      SAFE_V0_ADAPTER,
      modules(input.setup.validators),
      modules(input.setup.executors),
      modules(input.setup.fallbacks),
      modules(input.setup.hooks),
      [...attesters.addresses],
      attesters.threshold,
    ],
  })
  const initializer = encodeFunctionData({
    abi: parseAbi([
      'function setup(address[] _owners,uint256 _threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)',
    ]),
    functionName: 'setup',
    args: [
      [...primaryOwnerAddresses(input.owner)],
      primaryThreshold(input.owner),
      SAFE_V0_LAUNCHPAD,
      addSafe7579,
      SAFE_V0_ADAPTER,
      zeroAddress,
      0n,
      zeroAddress,
    ],
  })
  const nonce =
    input.account.nonce.source === 'explicit' ? input.account.nonce.value : 0n
  return {
    factory: SAFE_FACTORY,
    factoryData: encodeFunctionData({
      abi: parseAbi([
        'function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce)',
      ]),
      functionName: 'createProxyWithNonce',
      args: [SAFE_SINGLETON, initializer, nonce],
    }),
  }
}

export function createSafeAdapter(
  construction: AccountConstruction,
): AccountAdapter {
  if (construction.account.kind !== 'safe') {
    throw new Error('Expected Safe account')
  }
  const validator = construction.setup.validators[0]?.address ?? zeroAddress
  return {
    account: construction.account,
    capabilities: {
      modular: true,
      supportsDeployment: true,
      supportsUserOperations: true,
      supportsEip7702Adoption: false,
      supportsSmartSessions: true,
      supportsOriginSignatureReuse: true,
      signatureEnvelope: { kind: 'safe', validator },
    },
    getIdentity: (input) => ({
      definition: input.account,
      address: safeMaterial(input).address,
    }),
    getDeploymentPlan: (input) =>
      deploymentPlan(input.chain, safeMaterial(input), input.deployed),
    encodeCalls: encodeErc7579Calls,
    encodeModuleInstallation: (module) => [encodeInstallModule(module)],
    encodeModuleUninstallation: encodeUninstallModule,
    encodeSignatureEnvelope: ({ envelope, validatorContribution }) => {
      if (envelope.kind !== 'safe') throw new Error('Expected Safe envelope')
      return encodeAddressEnvelope(envelope.validator, validatorContribution)
    },
  }
}
