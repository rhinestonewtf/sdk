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
  let signed = await signIntent(context, prepared)
  if (input.eip7702InitSignature) {
    signed = {
      ...signed,
      authorizations: await context.signAuthorizations({
        chains: authorizationChains(input),
        eip7702InitSignature: input.eip7702InitSignature,
      }),
    }
  }
  return submitIntent(context, signed)
}

function authorizationChains<CompatibilityConfig>(
  input: IntentInput<CompatibilityConfig>,
) {
  const chains = new Map<string, import('../../chains/types').ChainReference>(
    (input.sourceChains ?? []).map((chain) => [chain.caip2, chain]),
  )
  chains.set(input.destination.caip2, input.destination)
  return [...chains.values()]
}
