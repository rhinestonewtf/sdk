import { concat, encodeAbiParameters, type Hex } from 'viem'
import type { ResolvedModule } from '../types'
import type { AtomicValidatorDefinition } from './types'

export const OWNABLE_VALIDATOR_ADDRESS =
  '0x000000000013fdb5234e4e3162a810f54d9f7e98' as const
export const OWNABLE_V0_VALIDATOR_ADDRESS =
  '0x2483da3a338895199e5e538530213157e931bf06' as const
export const OWNABLE_BETA_VALIDATOR_ADDRESS =
  '0x0000000000e9e6e96bcaa3c113187cdb7e38aed9' as const

export const ECDSA_MOCK_SIGNATURE =
  '0x81d4b4981670cb18f99f0b4a66446df1bf5b204d24cfcb659bf38ba27a4359b5711649ec2423c5e1247245eba2964679b6a1dbb85c992ae40b9b00c6935b02ff1b' as const

function moduleAddress(definition: AtomicValidatorDefinition) {
  return definition.module.source === 'explicit'
    ? definition.module.address
    : OWNABLE_VALIDATOR_ADDRESS
}

export function resolveOwnableAddresses(input: {
  readonly owners: readonly `0x${string}`[]
  readonly threshold: number
  readonly address?: `0x${string}`
}): ResolvedModule {
  return {
    kind: 'validator',
    address: input.address ?? OWNABLE_VALIDATOR_ADDRESS,
    initData: encodeAbiParameters(
      [
        { name: 'threshold', type: 'uint256' },
        { name: 'owners', type: 'address[]' },
      ],
      [
        BigInt(input.threshold),
        input.owners
          .map((owner) => owner.toLowerCase() as `0x${string}`)
          .sort(),
      ],
    ),
    deInitData: '0x',
    additionalContext: '0x',
  }
}

export function resolveOwnableValidator(
  definition: AtomicValidatorDefinition,
): ResolvedModule {
  const owners = definition.owners
    .map((owner) => {
      if (owner.kind === 'webauthn') {
        throw new Error('Ownable validator contains a WebAuthn owner')
      }
      return owner.account.address.toLowerCase() as `0x${string}`
    })
    .sort()
  return resolveOwnableAddresses({
    owners,
    threshold: definition.threshold,
    address: moduleAddress(definition),
  })
}

export function encodeOwnableMockSignature(ownerCount: number): Hex {
  return concat(Array.from({ length: ownerCount }, () => ECDSA_MOCK_SIGNATURE))
}
