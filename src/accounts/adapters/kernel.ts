import {
  concat,
  concatHex,
  decodeAbiParameters,
  decodeFunctionData,
  domainSeparator,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  type Hex,
  keccak256,
  parseAbi,
  stringToHex,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem'
import { moduleTypeId } from '../../modules/erc7579-abi'
import type { ResolvedModule } from '../../modules/types'
import type { AccountAdapter } from '../adapter'
import { type DeploymentMaterial, deploymentPlan } from '../deployment'
import { encodeErc7579Calls } from '../erc7579-calls'
import type { AccountConstruction } from '../types'
import { encodeUninstallModule } from './shared'

const KERNEL_META_FACTORY_ADDRESS =
  '0xd703aae79538628d27099b8c4f621be4ccd142d5' as const
export const KERNEL_IMPLEMENTATION_ADDRESS =
  '0xd6cedde84be40893d153be9d467cd6ad37875b28' as const
const KERNEL_FACTORY_ADDRESS =
  '0x2577507b78c2008ff367261cb6285d44ba5ef2e9' as const
const KERNEL_BYTECODE =
  '0x603d3d8160223d3973d6cedde84be40893d153be9d467cd6ad37875b2860095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3' as const
const HOOK_INSTALLED_ADDRESS =
  '0x0000000000000000000000000000000000000001' as const

export function wrapKernelMessageHash(messageHash: Hex, account: Hex): Hex {
  const separator = domainSeparator({
    domain: {
      name: 'Kernel',
      version: '0.3.3',
      chainId: 0,
      verifyingContract: account,
    },
  })
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }],
      [keccak256(stringToHex('Kernel(bytes32 hash)')), messageHash],
    ),
  )
  return keccak256(concatHex(['0x1901', separator, structHash]))
}

export function kernelInstallData(module: ResolvedModule): readonly Hex[] {
  const install = (initData: Hex) =>
    encodeFunctionData({
      abi: parseAbi(['function installModule(uint256,address,bytes)']),
      functionName: 'installModule',
      args: [moduleTypeId(module.kind), module.address, initData],
    })
  switch (module.kind) {
    case 'validator': {
      const data = encodeAbiParameters(
        [{ type: 'bytes' }, { type: 'bytes' }, { type: 'bytes' }],
        [module.initData, '0x', '0x'],
      )
      return [
        install(concat([HOOK_INSTALLED_ADDRESS, data])),
        encodeFunctionData({
          abi: parseAbi(['function grantAccess(bytes21,bytes4,bool)']),
          functionName: 'grantAccess',
          args: [concat(['0x01', module.address]), '0xe9ae5c53', true],
        }),
      ]
    }
    case 'executor': {
      const data = encodeAbiParameters(
        [{ type: 'bytes' }, { type: 'bytes' }],
        [module.initData, '0x'],
      )
      return [install(concat([zeroAddress, data]))]
    }
    case 'fallback': {
      const [selector, flags, selectorData] = decodeAbiParameters(
        [{ type: 'bytes4' }, { type: 'bytes1' }, { type: 'bytes' }],
        module.initData,
      )
      const data = encodeAbiParameters(
        [{ type: 'bytes' }, { type: 'bytes' }],
        [concat([flags, selectorData]), '0x'],
      )
      return [install(concat([selector, HOOK_INSTALLED_ADDRESS, data]))]
    }
    case 'hook':
      return [install(module.initData)]
  }
}

function kernelMaterial(input: AccountConstruction): DeploymentMaterial {
  if (input.account.kind !== 'kernel')
    throw new Error('Expected Kernel account')
  if (input.eoa) return { address: input.eoa.address }
  if (input.initData && !('factory' in input.initData)) {
    return { address: input.initData.address }
  }
  let factoryData: Hex
  let salt: Hex
  let initializationCallData: Hex
  if (input.initData && 'factory' in input.initData) {
    const decoded = decodeFunctionData({
      abi: parseAbi([
        'function deployWithFactory(address factory,bytes createData,bytes32 salt)',
      ]),
      data: input.initData.factoryData,
    })
    if (
      decoded.args[0].toLowerCase() !== KERNEL_FACTORY_ADDRESS.toLowerCase()
    ) {
      throw new Error('Unsupported Kernel implementation')
    }
    factoryData = input.initData.factoryData
    initializationCallData = decoded.args[1]
    salt = decoded.args[2]
  } else {
    const rootValidator = input.setup.validators[0]
    if (!rootValidator) throw new Error('Kernel root validator is required')
    const initConfig = [
      ...input.setup.validators.slice(1),
      ...input.setup.executors,
      ...input.setup.fallbacks,
      ...input.setup.hooks,
    ].flatMap(kernelInstallData)
    initializationCallData = encodeFunctionData({
      abi: parseAbi([
        'function initialize(bytes21,address,bytes,bytes,bytes[])',
      ]),
      functionName: 'initialize',
      args: [
        concat(['0x01', rootValidator.address]),
        zeroAddress,
        rootValidator.initData,
        '0x',
        initConfig,
      ],
    })
    salt =
      input.account.salt.source === 'explicit'
        ? input.account.salt.value
        : zeroHash
    factoryData = encodeFunctionData({
      abi: parseAbi(['function deployWithFactory(address,bytes,bytes32)']),
      functionName: 'deployWithFactory',
      args: [KERNEL_FACTORY_ADDRESS, initializationCallData, salt],
    })
  }
  const actualSalt = keccak256(concat([initializationCallData, salt]))
  const address = getContractAddress({
    from: KERNEL_FACTORY_ADDRESS,
    opcode: 'CREATE2',
    bytecode: KERNEL_BYTECODE,
    salt: actualSalt,
  })
  return {
    address,
    factory: input.initData?.factory ?? KERNEL_META_FACTORY_ADDRESS,
    factoryData,
  }
}

export function createKernelAdapter(
  construction: AccountConstruction,
): AccountAdapter {
  if (construction.account.kind !== 'kernel') {
    throw new Error('Expected Kernel account')
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
      signatureEnvelope: { kind: 'kernel', validator, isRoot: true },
    },
    getIdentity: (input) => ({
      definition: input.account,
      address: kernelMaterial(input).address,
    }),
    getDeploymentPlan: (input) =>
      deploymentPlan(input.chain, kernelMaterial(input), input.deployed),
    encodeCalls: encodeErc7579Calls,
    encodeModuleInstallation: kernelInstallData,
    encodeModuleUninstallation: encodeUninstallModule,
    encodeSignatureEnvelope: ({ envelope, validatorContribution }) => {
      if (envelope.kind !== 'kernel')
        throw new Error('Expected Kernel envelope')
      return concat([
        envelope.isRoot ? '0x00' : concat(['0x01', envelope.validator]),
        keccak256(toHex('kernel.replayable.signature')),
        validatorContribution,
      ])
    },
  }
}
