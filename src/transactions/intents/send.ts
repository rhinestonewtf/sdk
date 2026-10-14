import { prepareIntent } from './prepare'
import { signIntent } from './sign-transaction'
import { submitIntent } from './submit'
import type {
  IntentInput,
  IntentWorkflowContext,
  SubmittedIntent,
} from './types'

export async function sendIntent<CompatibilityConfig>(
  context: IntentWorkflowContext<CompatibilityConfig>,
  input: IntentInput<CompatibilityConfig>,
): Promise<SubmittedIntent> {
  const prepared = await prepareIntent(context, input)
  // `signIntent` produces the complete ordered proof vector, including any
  // EIP-7702 delegation the quote asked for, so there is no separate
  // authorization step to fold in here.
  const signed = await signIntent(context, prepared)
  return submitIntent(context, signed)
}
