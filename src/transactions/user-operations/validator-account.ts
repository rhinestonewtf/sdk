import type { Hex } from 'viem'
import type { AccountRuntime } from '../../accounts/adapter'
import { encodeMultiFactorContribution } from '../../modules/validators/multi-factor'
import { encodeOwnableMockSignature } from '../../modules/validators/ownable'
import { resolveValidator } from '../../modules/validators/resolve'
import { WEBAUTHN_MOCK_SIGNATURE } from '../../modules/validators/webauthn'
import type { SigningContext } from '../../signing/context'

export function getUserOperationStubSignature(
  runtime: AccountRuntime,
  context: SigningContext,
): Hex {
  if (!runtime.adapter.capabilities.supportsUserOperations) {
    throw new Error(
      `Account ${runtime.construction.account.kind} does not support UserOperations`,
    )
  }
  if (context.validator.kind === 'passkey') return WEBAUTHN_MOCK_SIGNATURE
  if (context.validator.kind === 'multi-factor') {
    return encodeMultiFactorContribution({
      factorOrder: context.validator.validators.map(({ id }) => id),
      threshold: context.validator.threshold,
      contributions: context.validator.validators.map((validator) => ({
        factorId: validator.id,
        publicId: validator.publicId,
        validator: resolveValidator(validator).address,
        contribution:
          validator.kind === 'passkey'
            ? WEBAUTHN_MOCK_SIGNATURE
            : encodeOwnableMockSignature(validator.owners.length),
      })),
    })
  }
  return encodeOwnableMockSignature(context.validator.owners.length)
}
