import { chainIdFromReference } from '../../chains/caip2'
import { projectCompatibleIntentInput } from './compatibility'
import type {
  IntentWorkflowContext,
  SignedIntent,
  SubmittedIntent,
} from './types'

export async function submitIntent<CompatibilityConfig>(
  context: IntentWorkflowContext<CompatibilityConfig>,
  signed: SignedIntent<CompatibilityConfig>,
): Promise<SubmittedIntent> {
  const response = await context.submissionClient.submitIntent(
    {
      intentId: signed.prepared.quote.intentId,
      signatures: {
        origin: signed.originSignatures,
        destination: signed.destinationSignature,
        ...(signed.targetSignature
          ? { targetExecution: signed.targetSignature }
          : {}),
      },
      ...(signed.authorizations && signed.authorizations.length > 0
        ? { authorizations: { sponsor: signed.authorizations } }
        : {}),
      ...(signed.dryRun ? { dryRun: true } : {}),
    },
    {
      intentInput: projectCompatibleIntentInput(signed.prepared.request),
      sponsored: Boolean(signed.prepared.request.options.sponsorSettings),
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
