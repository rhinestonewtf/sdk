import type { Hex } from 'viem'
import { wrapKernelMessageHash } from '../accounts/kernel-signing'
import type { EvmChainReference } from '../chains/types'
import { getQuorumSignableHash } from '../modules/validators/quorum'
import type { SigningContext } from './context'

export function resolveAccountValidatorSignableHash(input: {
  readonly hash: Hex
  readonly chain: EvmChainReference
  readonly context: SigningContext
}): Hex {
  const accountHash =
    input.context.account.definition.kind === 'kernel'
      ? wrapKernelMessageHash(input.hash, input.context.account.address)
      : input.hash
  return input.context.validator.kind === 'quorum'
    ? getQuorumSignableHash({
        validator:
          input.context.validatorCapabilities.compatibilityKey.moduleAddress,
        chainId: input.chain.id,
        account: input.context.account.address,
        hash: accountHash,
      })
    : accountHash
}
