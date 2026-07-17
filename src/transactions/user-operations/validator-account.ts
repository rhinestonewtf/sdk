import { concat, type Hex } from 'viem'
import type { AccountRuntime } from '../../accounts/adapter'
import { ECDSA_MOCK_SIGNATURE } from '../../modules/validators/ownable'
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
    return concat(
      context.validator.validators.map((validator) =>
        validator.kind === 'passkey'
          ? WEBAUTHN_MOCK_SIGNATURE
          : concat(validator.owners.map(() => ECDSA_MOCK_SIGNATURE)),
      ),
    )
  }
  return concat(context.validator.owners.map(() => ECDSA_MOCK_SIGNATURE))
}
