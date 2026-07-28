import type { Address } from 'viem'
import type { ResolvedModule } from '../types'
import { resolveOwnableAddresses } from './ownable'

export const SOCIAL_RECOVERY_VALIDATOR_ADDRESS: Address =
  '0xa04d053b3c8021e8d5bf641816c42daa75d8b597'

/**
 * Resolves the social recovery validator module.
 *
 * The module shares the ownable validator's `(threshold, address[])` init
 * encoding and its concatenated-ECDSA signature format, so it resolves through
 * the same encoder at a different address. `onInstall` requires the guardian
 * list to be sorted and unique, which `resolveOwnableAddresses` guarantees.
 */
export function resolveSocialRecoveryValidator(input: {
  readonly guardians: readonly Address[]
  readonly threshold?: number
}): ResolvedModule {
  return resolveOwnableAddresses({
    owners: input.guardians,
    threshold: input.threshold ?? 1,
    address: SOCIAL_RECOVERY_VALIDATOR_ADDRESS,
  })
}
