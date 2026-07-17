import type {
  SubmittedUserOperation,
  UserOperationStatus,
  UserOperationWorkflowContext,
} from './types'

const receiptPollIntervalMs = 500

export async function getUserOperationStatus<CompatibilityConfig>(
  context: Pick<UserOperationWorkflowContext<CompatibilityConfig>, 'bundler'>,
  submitted: SubmittedUserOperation,
): Promise<UserOperationStatus> {
  const receipt = await context.bundler.getReceipt(
    submitted.chain,
    submitted.hash,
  )
  return {
    hash: submitted.hash,
    ...(receipt ? { receipt } : {}),
    terminal: receipt !== undefined,
  }
}

export async function waitForUserOperationStatus<CompatibilityConfig>(
  context: Pick<
    UserOperationWorkflowContext<CompatibilityConfig>,
    'bundler' | 'clock'
  >,
  submitted: SubmittedUserOperation,
): Promise<UserOperationStatus> {
  for (;;) {
    const status = await getUserOperationStatus(context, submitted)
    if (status.terminal) return status
    await context.clock.sleep(receiptPollIntervalMs)
  }
}
