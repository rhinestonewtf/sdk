import {
  type Address,
  concat,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  pad,
  toHex,
} from 'viem'
import type { ResolvedModule } from '../types'
import type { MultiFactorValidatorDefinition } from './types'

export const MULTI_FACTOR_VALIDATOR_ADDRESS: Address =
  '0xf6bdf42c9be18ceca5c06c42a43daf7fbbe7896b'

export type AtomicValidatorResolver = (
  definition: MultiFactorValidatorDefinition['validators'][number],
) => ResolvedModule

export function encodeValidatorId(id: number | Hex): Hex {
  return pad(typeof id === 'number' ? toHex(id) : id, { size: 12 })
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

export function encodeMultiFactorContribution(input: {
  readonly factorOrder: readonly string[]
  readonly threshold: number
  readonly contributions: readonly {
    readonly factorId: string
    readonly publicId: number | Hex
    readonly validator: `0x${string}`
    readonly contribution: Hex
  }[]
}): Hex {
  if (input.threshold < 1 || input.threshold > input.factorOrder.length) {
    throw new Error('Validator threshold is outside the configured factor set')
  }
  const configured = new Set(input.factorOrder)
  const contributions = new Map<string, (typeof input.contributions)[number]>()
  for (const contribution of input.contributions) {
    if (!configured.has(contribution.factorId)) {
      throw new Error(`Unknown validator factor ${contribution.factorId}`)
    }
    if (contributions.has(contribution.factorId)) {
      throw new Error(`Duplicate validator factor ${contribution.factorId}`)
    }
    contributions.set(contribution.factorId, contribution)
  }
  const ordered = input.factorOrder.flatMap((factorId) => {
    const contribution = contributions.get(factorId)
    return contribution ? [contribution] : []
  })
  if (ordered.length < input.threshold) {
    throw new Error(
      `Insufficient validator contributions: required ${input.threshold}, received ${ordered.length}`,
    )
  }
  return encodeAbiParameters(
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
    [
      ordered.map((contribution) => ({
        packedValidatorAndId: concat([
          encodeValidatorId(contribution.publicId),
          contribution.validator,
        ]),
        data: contribution.contribution,
      })),
    ],
  )
}
