import { signUserOperationPayload } from '../../signing/user-operation'
import type {
  PreparedUserOperation,
  SignedUserOperation,
  UserOperationWorkflowContext,
} from './types'

export async function signUserOperation<CompatibilityConfig>(
  context: UserOperationWorkflowContext<CompatibilityConfig>,
  prepared: PreparedUserOperation<CompatibilityConfig>,
): Promise<SignedUserOperation<CompatibilityConfig>> {
  const { signature, transcript } = await signUserOperationPayload({
    planInput: prepared.signing,
    signerInvoker: context.signerInvoker,
    checkpoints: context.checkpoints,
  })
  return {
    prepared,
    operation: { ...prepared.operation, signature },
    signature,
    transcript,
  }
}
