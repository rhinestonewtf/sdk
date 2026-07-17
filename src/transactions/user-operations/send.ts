import { prepareUserOperation } from './prepare'
import { signUserOperation } from './sign'
import { submitUserOperation } from './submit'
import type {
  SubmittedUserOperation,
  UserOperationInput,
  UserOperationWorkflowContext,
} from './types'

export async function sendUserOperation<CompatibilityConfig>(
  context: UserOperationWorkflowContext<CompatibilityConfig>,
  input: UserOperationInput<CompatibilityConfig>,
): Promise<SubmittedUserOperation> {
  const prepared = await prepareUserOperation(context, input)
  const signed = await signUserOperation(context, prepared)
  return submitUserOperation(context, signed)
}
