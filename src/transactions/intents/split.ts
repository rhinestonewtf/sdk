import type { Address } from 'viem'
import type { IntentSplitPort } from '../../clients/orchestrator/port'
import type { OrchestratorSplitResult } from '../../clients/orchestrator/types'

export function splitIntents(
  client: IntentSplitPort,
  input: {
    readonly chainId: number
    readonly tokens: Readonly<Record<Address, bigint>>
    readonly settlementLayers?:
      | { readonly include: readonly string[] }
      | { readonly exclude: readonly string[] }
  },
): Promise<OrchestratorSplitResult> {
  return client.splitIntents(input)
}
