import type { Address } from 'viem'
import type { AccountRuntime } from '../../accounts/adapter'
import type { ChainReference } from '../../chains/types'
import type { OrchestratorAccount } from '../../clients/orchestrator/types'

export function projectIntentAccount(input: {
  readonly runtime: AccountRuntime
  readonly setupOverride?: readonly {
    readonly to: Address
    readonly data: `0x${string}`
  }[]
}): OrchestratorAccount {
  const deployment = input.runtime.adapter.getDeploymentPlan(
    input.runtime.construction,
  )
  const setupOps = input.setupOverride
    ? [...input.setupOverride]
    : !deployment.factory || !deployment.factoryData
      ? []
      : [{ to: deployment.factory, data: deployment.factoryData }]
  const adoption = input.runtime.construction.eoa
    ? input.runtime.adapter.getEip7702AdoptionPlan?.(input.runtime.construction)
    : undefined
  return {
    address: input.runtime.identity.address,
    accountType:
      input.runtime.construction.account.kind === 'eoa' ? 'EOA' : 'ERC7579',
    setupOps,
    // Mirror the legacy request shape: the `delegations` key is always present
    // (undefined for non-7702 accounts, a cross-chain map for 7702).
    delegations: adoption ? { 0: { contract: adoption.contract } } : undefined,
  }
}

export function projectIntentRecipient(
  recipient: Address | string | undefined,
  destination: ChainReference,
): OrchestratorAccount | undefined {
  if (!recipient) return undefined
  return destination.kind === 'non-evm'
    ? { address: recipient }
    : { address: recipient, accountType: 'EOA', setupOps: [] }
}
