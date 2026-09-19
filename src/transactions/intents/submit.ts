import { chainIdFromReference } from '../../chains/caip2'
import {
  isSponsoredIntentInput,
  projectCompatibleIntentInput,
} from '../../clients/orchestrator/normalized'
import type {
  IntentWorkflowContext,
  SignedIntent,
  SubmittedIntent,
} from './types'

export async function submitIntent<CompatibilityConfig>(
  context: IntentWorkflowContext<CompatibilityConfig>,
  signed: SignedIntent<CompatibilityConfig>,
): Promise<SubmittedIntent> {
  // Submission carries the intent id and the ordered proofs, nothing else: no
  // signatures are acquired here and no mutable nonce state is read.
  const response = await context.submissionClient.submitIntent(
    {
      intentId: signed.prepared.quote.intentId,
      proofs: signed.proofs,
      ...(signed.dryRun ? { dryRun: true } : {}),
    },
    {
      intentInput: projectCompatibleIntentInput(signed.prepared.normalized),
      sponsored: isSponsoredIntentInput(signed.prepared.normalized),
    },
  )
  return {
    type: 'intent',
    traceId: response.traceId,
    intentId: response.intentId,
    ...(signed.prepared.input.sourceChains
      ? {
          sourceChains: signed.prepared.input.sourceChains.map(({ id }) => id),
        }
      : {}),
    targetChain: chainIdFromReference(signed.prepared.input.destination),
  }
}
