import { WaitForUserOperationReceiptTimeoutError } from 'viem/account-abstraction'
import { getChainById } from '../../chains/catalog'
import type {
  SubmittedUserOperation,
  UserOperationStatus,
  UserOperationWorkflowContext,
} from './types'

const receiptTimeoutMs = 120_000

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
  const timeoutError = () =>
    new WaitForUserOperationReceiptTimeoutError({ hash: submitted.hash })
  return context.clock.timeout(
    pollForUserOperationStatus(context, submitted, timeoutError),
    receiptTimeoutMs,
    timeoutError,
  )
}

async function pollForUserOperationStatus<CompatibilityConfig>(
  context: Pick<
    UserOperationWorkflowContext<CompatibilityConfig>,
    'bundler' | 'clock'
  >,
  submitted: SubmittedUserOperation,
  timeoutError: () => WaitForUserOperationReceiptTimeoutError,
): Promise<UserOperationStatus> {
  const startedAt = context.clock.now()
  const blockTime = getChainById(submitted.chain.id).blockTime ?? 12_000
  const pollIntervalMs = Math.min(
    Math.max(Math.floor(blockTime / 2), 500),
    4_000,
  )
  let waitedMs = 0
  for (;;) {
    const status = await getUserOperationStatus(context, submitted)
    if (status.terminal) return status
    const elapsed = Math.max(context.clock.now() - startedAt, waitedMs)
    const remaining = receiptTimeoutMs - elapsed
    if (remaining <= 0) {
      throw timeoutError()
    }
    const delay = Math.min(pollIntervalMs, remaining)
    await context.clock.sleep(delay)
    waitedMs += delay
    if (
      Math.max(context.clock.now() - startedAt, waitedMs) >= receiptTimeoutMs
    ) {
      throw timeoutError()
    }
  }
}
