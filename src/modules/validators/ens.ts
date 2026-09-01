import { encodeAbiParameters, type Hex, maxUint48 } from 'viem'
import type { ResolvedModule } from '../types'
import { compareHexValues } from './ordering'
import type { AtomicValidatorDefinition } from './types'

export const ENS_HCA_MODULE =
  '0x5049ecBd4d961aE6DFEED9b7ccCe7f026454970E' as const

function ensOwners(definition: AtomicValidatorDefinition) {
  return definition.owners
    .map((owner) => {
      if (owner.kind !== 'ens') {
        throw new Error('ENS validator contains a non-ENS owner')
      }
      return {
        addr: owner.account.address.toLowerCase() as `0x${string}`,
        expiration: owner.expiration
          ? Math.floor(owner.expiration.getTime() / 1000)
          : Number(maxUint48),
      }
    })
    .sort((left, right) => compareHexValues(left.addr, right.addr))
}

/**
 * The configuration the ENS validator's stateless path expects: the threshold
 * followed by the sorted owner addresses, without expirations. That path
 * deliberately skips the expiration check, because expiry lives in the
 * validator's own storage and a stateless caller has none — so an expired owner
 * still satisfies an ENS factor nested under multi-factor.
 */
export function encodeEnsStatelessData(
  definition: AtomicValidatorDefinition,
): Hex {
  return encodeAbiParameters(
    [
      { name: 'threshold', type: 'uint256' },
      { name: 'owners', type: 'address[]' },
    ],
    [
      BigInt(definition.threshold),
      ensOwners(definition).map((owner) => owner.addr),
    ],
  )
}

export function resolveEnsValidator(
  definition: AtomicValidatorDefinition,
): ResolvedModule {
  return {
    kind: 'validator',
    address: ENS_HCA_MODULE,
    initData: encodeAbiParameters(
      [
        { name: 'threshold', type: 'uint256' },
        {
          name: 'owners',
          type: 'tuple[]',
          components: [
            { name: 'addr', type: 'address' },
            { name: 'expiration', type: 'uint48' },
          ],
        },
      ],
      [BigInt(definition.threshold), ensOwners(definition)],
    ),
    deInitData: '0x',
    additionalContext: '0x',
  }
}
