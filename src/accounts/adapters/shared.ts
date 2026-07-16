import { encodeFunctionData, encodePacked, type Hex, zeroAddress } from 'viem'
import { moduleTypeId } from '../../modules/erc7579-abi'
import type { ResolvedModule } from '../../modules/types'
import type { ResolvedValidatorDefinition } from '../../modules/validators/types'

export function primaryOwnerAddresses(
  validator: ResolvedValidatorDefinition,
): readonly `0x${string}`[] {
  if (validator.kind === 'passkey' || validator.kind === 'multi-factor') {
    return ['0xbabe99e62d8bcbd3acf5ccbcfcd4f64fe75e5e72']
  }
  return validator.owners.map((owner) => {
    if (owner.kind === 'webauthn') {
      throw new Error('Validator owner does not expose an address')
    }
    return owner.account.address
  })
}

export function primaryThreshold(
  validator: ResolvedValidatorDefinition,
): bigint {
  return BigInt(
    validator.kind === 'passkey' || validator.kind === 'multi-factor'
      ? 1
      : validator.threshold,
  )
}

export function encodeInstallModule(module: ResolvedModule): Hex {
  return encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'installModule',
        inputs: [
          { type: 'uint256', name: 'moduleTypeId' },
          { type: 'address', name: 'module' },
          { type: 'bytes', name: 'initData' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'installModule',
    args: [moduleTypeId(module.kind), module.address, module.initData],
  })
}

export function encodeUninstallModule(module: ResolvedModule): Hex {
  return encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'uninstallModule',
        inputs: [
          { type: 'uint256', name: 'moduleTypeId' },
          { type: 'address', name: 'module' },
          { type: 'bytes', name: 'deInitData' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'uninstallModule',
    args: [moduleTypeId(module.kind), module.address, module.deInitData],
  })
}

export function encodeAddressEnvelope(
  validator: `0x${string}`,
  signature: Hex,
  defaultValidator?: `0x${string}`,
): Hex {
  const address =
    defaultValidator?.toLowerCase() === validator.toLowerCase()
      ? zeroAddress
      : validator
  return encodePacked(['address', 'bytes'], [address, signature])
}
