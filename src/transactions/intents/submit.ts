import { chainIdFromReference } from '../../chains/caip2'
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
  // signatures are acquired here, no mutable nonce state is read, and no
  // sponsorship grant is requested: that was presented with the quote.
  const response = await context.submissionClient.submitIntent({
    intentId: signed.prepared.quote.intentId,
    proofs: signed.proofs,
    ...(signed.dryRun ? { dryRun: true } : {}),
  })
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
