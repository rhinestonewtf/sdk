import type {
  SignedUserOperation,
  SubmittedUserOperation,
  UserOperationWorkflowContext,
} from './types'

export async function submitUserOperation<CompatibilityConfig>(
  context: UserOperationWorkflowContext<CompatibilityConfig>,
  signed: SignedUserOperation<CompatibilityConfig>,
): Promise<SubmittedUserOperation> {
  const operation = { ...signed.operation, signature: signed.signature }
  return {
    type: 'userop',
    chain: signed.prepared.input.chain,
    hash: await context.bundler.send(signed.prepared.input.chain, operation),
  }
}
