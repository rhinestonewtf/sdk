import type { SdkAccount } from '../builds'
import type { Layer } from '../canonical/types'
import { FIXTURES, type FixtureName } from '../funded/fixtures'
import type { ScenarioContext } from '../scenario'

// Shared pieces of the funded scenarios: they quote, sign, submit for real
// and wait for the intent on prod testnets.

const FUNDED_LAYERS: Layer[] = [
  'quoteRequest',
  'typedData',
  'signatures',
  'submitRequest',
  'traffic',
]

function fixtureAccount(
  ctx: ScenarioContext,
  name: FixtureName,
  sdk = ctx.sdk(),
): Promise<SdkAccount> {
  return sdk.createAccount(FIXTURES[name].config())
}

// Quote, messages, sign, submit and wait without preconfirmations.
async function execute(
  ctx: ScenarioContext,
  account: SdkAccount,
  transaction: Record<string, unknown>,
  hooks: { beforeSubmit?(prepared: unknown): Promise<void> } = {},
): Promise<void> {
  const prepared = await ctx.step('prepare', 'prepare', () =>
    account.prepareTransaction(transaction),
  )
  await ctx.step('messages', 'messages', () =>
    account.getTransactionMessages(prepared),
  )
  const signed = await ctx.step('sign', 'sign', () =>
    account.signTransaction(prepared),
  )
  await hooks.beforeSubmit?.(prepared)
  const result = await ctx.step('submit', 'submit', () =>
    account.submitTransaction(signed),
  )
  await ctx.step('wait', 'wait', () => account.waitForExecution(result, false))
}

export { execute, FUNDED_LAYERS, fixtureAccount }
