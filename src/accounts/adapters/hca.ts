import {
  type Address,
  concat,
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionData,
  encodePacked,
  type Hex,
  keccak256,
  pad,
  parseAbi,
  slice,
} from 'viem'
import { ENS_HCA_MODULE } from '../../modules/validators/ens'
import type { AccountAdapter } from '../adapter'
import { type DeploymentMaterial, deploymentPlan } from '../deployment'
import { encodeErc7579Calls } from '../erc7579-calls'
import { ModuleInstallationNotSupportedError } from '../error'
import type { AccountConstruction } from '../types'
import { encodeAddressEnvelope } from './shared'

export const HCA_IMPLEMENTATION_ADDRESS =
  '0x7c2cC1e499a87ab480Df154e05164cD56D05d570' as const
const HCA_FACTORY_ADDRESS =
  '0x358680728dedb552adaa9f5eb5d4395b291cf943' as const
const CREATE3_PROXY_HASH =
  '0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f' as const

function primaryOwner(factoryData: Hex): Address {
  const decoded = decodeFunctionData({
    abi: parseAbi(['function createAccount(bytes)']),
    data: factoryData,
  })
  const [, owners] = decodeAbiParameters(
    [
      { type: 'uint256' },
      {
        type: 'tuple[]',
        components: [
          { name: 'addr', type: 'address' },
          { name: 'expiration', type: 'uint48' },
        ],
      },
    ],
    decoded.args[0],
  )
  const owner = owners[0]
  if (!owner) throw new Error('HCA primary owner is required')
  return owner.addr
}

function predictCreate3Address(factory: Address, owner: Address): Address {
  const salt = pad(owner as Hex, { size: 32, dir: 'right' })
  const proxyHash = keccak256(
    encodePacked(
      ['bytes1', 'address', 'bytes32', 'bytes32'],
      ['0xff', factory, salt, CREATE3_PROXY_HASH],
    ),
  )
  const proxyAddress = slice(proxyHash, 12, 32)
  return slice(keccak256(concat(['0xd694', proxyAddress, '0x01'])), 12, 32)
}

function hcaMaterial(input: AccountConstruction): DeploymentMaterial {
  if (input.account.kind !== 'hca') throw new Error('Expected HCA account')
  if (input.eoa) return { address: input.eoa.address }
  if (input.sessions.enabled || input.modules.length > 0) {
    throw new Error(
      'HCA accounts cannot install sessions or additional modules',
    )
  }
  if (!input.owner || input.owner.kind !== 'ens') {
    throw new Error('HCA accounts require ENS owners')
  }
  if (input.initData && !('factory' in input.initData)) {
    return { address: input.initData.address }
  }
  let factory: Address
  let factoryData: Hex
  if (input.initData && 'factory' in input.initData) {
    factory = input.initData.factory
    factoryData = input.initData.factoryData
    try {
      decodeFunctionData({
        abi: parseAbi(['function createAccount(bytes)']),
        data: factoryData,
      })
    } catch {
      return { address: input.initData.address }
    }
  } else {
    factory =
      input.account.factory.source === 'explicit'
        ? input.account.factory.value
        : HCA_FACTORY_ADDRESS
    const validator = input.setup.validators[0]
    if (!validator) throw new Error('HCA owner validator is required')
    factoryData = encodeFunctionData({
      abi: parseAbi(['function createAccount(bytes)']),
      functionName: 'createAccount',
      args: [validator.initData],
    })
  }
  return {
    address: predictCreate3Address(factory, primaryOwner(factoryData)),
    factory,
    factoryData,
  }
}

export function createHcaAdapter(
  construction: AccountConstruction,
): AccountAdapter {
  if (construction.account.kind !== 'hca') {
    throw new Error('Expected HCA account')
  }
  return {
    account: construction.account,
    capabilities: {
      modular: false,
      supportsDeployment: true,
      supportsUserOperations: true,
      supportsEip7702Adoption: false,
      supportsSmartSessions: false,
      supportsOriginSignatureReuse: true,
      signatureEnvelope: { kind: 'hca', validator: ENS_HCA_MODULE },
    },
    getIdentity: (input) => ({
      definition: input.account,
      address: hcaMaterial(input).address,
    }),
    getDeploymentPlan: (input) =>
      deploymentPlan(input.chain, hcaMaterial(input), input.deployed),
    encodeCalls: encodeErc7579Calls,
    encodeModuleInstallation: () => {
      throw new ModuleInstallationNotSupportedError('hca')
    },
    encodeModuleUninstallation: () => {
      throw new ModuleInstallationNotSupportedError('hca')
    },
    encodeSignatureEnvelope: ({ envelope, validatorContribution }) => {
      if (envelope.kind !== 'hca') throw new Error('Expected HCA envelope')
      return encodeAddressEnvelope(
        envelope.validator,
        validatorContribution,
        ENS_HCA_MODULE,
      )
    },
  }
}
