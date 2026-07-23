import { encodeAbiParameters, maxUint48 } from 'viem'
import type { ResolvedModule } from '../types'
import type { AtomicValidatorDefinition } from './types'

export const ENS_HCA_MODULE =
  '0x5049ecBd4d961aE6DFEED9b7ccCe7f026454970E' as const

export function resolveEnsValidator(
  definition: AtomicValidatorDefinition,
): ResolvedModule {
  const owners = definition.owners
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
    .sort((left, right) => left.addr.localeCompare(right.addr))
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
      [BigInt(definition.threshold), owners],
    ),
    deInitData: '0x',
    additionalContext: '0x',
  }
}
