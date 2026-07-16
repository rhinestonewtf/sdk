import {
  concat,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  pad,
  toHex,
} from 'viem'
import type { ResolvedModule } from '../types'
import type { MultiFactorValidatorDefinition } from './types'

export const MULTI_FACTOR_VALIDATOR_ADDRESS =
  '0xf6bdf42c9be18ceca5c06c42a43daf7fbbe7896b' as const

export type AtomicValidatorResolver = (
  definition: MultiFactorValidatorDefinition['validators'][number],
) => ResolvedModule

export function encodeValidatorId(id: number | Hex): Hex {
  return pad(toHex(id), { size: 12 })
}

export function resolveMultiFactorValidator(
  definition: MultiFactorValidatorDefinition,
  resolveAtomic: AtomicValidatorResolver,
): ResolvedModule {
  const validators = definition.validators.map((validator) => {
    const module = resolveAtomic(validator)
    return {
      packedValidatorAndId: concat([
        encodeValidatorId(validator.publicId),
        module.address,
      ]),
      data: module.initData,
    }
  })
  return {
    kind: 'validator',
    address:
      definition.module.source === 'explicit'
        ? definition.module.address
        : MULTI_FACTOR_VALIDATOR_ADDRESS,
    initData: encodePacked(
      ['uint8', 'bytes'],
      [
        definition.threshold,
        encodeAbiParameters(
          [
            {
              name: 'validators',
              type: 'tuple[]',
              components: [
                { name: 'packedValidatorAndId', type: 'bytes32' },
                { name: 'data', type: 'bytes' },
              ],
            },
          ],
          [validators],
        ),
      ],
    ),
    deInitData: '0x',
    additionalContext: '0x',
  }
}
