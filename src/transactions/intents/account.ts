import type { Address, Hex } from 'viem'
import type { AccountRuntime } from '../../accounts/adapter'
import type { ChainReference } from '../../chains/types'
import type { OrchestratorAccount } from '../../clients/orchestrator/types'
import { Eip7702InitSignatureRequiredError } from '../../errors/execution'

export function projectIntentAccount(input: {
  readonly runtime: AccountRuntime
  readonly setupOverride?: readonly {
    readonly to: Address
    readonly data: `0x${string}`
  }[]
  readonly eip7702InitSignature?: Hex
}): OrchestratorAccount {
  const { runtime } = input
  const adoption = runtime.construction.eoa
    ? runtime.adapter.getEip7702AdoptionPlan?.(runtime.construction)
    : undefined
  const setupOps = input.setupOverride
    ? [...input.setupOverride]
    : adoption
      ? [eip7702SetupOp(runtime, input.eip7702InitSignature)]
      : deploymentSetupOps(runtime)
  return {
    address: runtime.identity.address,
    accountType:
      runtime.construction.account.kind === 'eoa' ? 'EOA' : 'ERC7579',
    setupOps,
    // Mirror the legacy request shape: the `delegations` key is always present
    // (undefined for non-7702 accounts, a cross-chain map for 7702).
    delegations: adoption ? { 0: { contract: adoption.contract } } : undefined,
  }
}

function deploymentSetupOps(
  runtime: AccountRuntime,
): { to: Address; data: Hex }[] {
  const deployment = runtime.adapter.getDeploymentPlan(runtime.construction)
  return !deployment.factory || !deployment.factoryData
    ? []
    : [{ to: deployment.factory, data: deployment.factoryData }]
}

// A 7702 account is routed by its `initializeAccount` setup op, which requires
// the EIP-7702 init signature at preparation time — even when the account is
// already deployed. Without it the orchestrator sees a bare smart account and
// finds no viable route.
function eip7702SetupOp(
  runtime: AccountRuntime,
  eip7702InitSignature: Hex | undefined,
): { to: Address; data: Hex } {
  if (
    !eip7702InitSignature ||
    eip7702InitSignature === '0x' ||
    !runtime.adapter.getEip7702InitCall
  ) {
    throw new Eip7702InitSignatureRequiredError()
  }
  return {
    to: runtime.identity.address,
    data: runtime.adapter.getEip7702InitCall(
      runtime.construction,
      eip7702InitSignature,
    ),
  }
}

export function projectIntentRecipient(
  recipient: Address | string,
  destination: ChainReference,
): OrchestratorAccount
export function projectIntentRecipient(
  recipient: undefined,
  destination: ChainReference,
): undefined
export function projectIntentRecipient(
  recipient: Address | string | undefined,
  destination: ChainReference,
): OrchestratorAccount | undefined {
  if (!recipient) return undefined
  return destination.kind === 'non-evm'
    ? { address: recipient }
    : { address: recipient, accountType: 'EOA', setupOps: [] }
}
