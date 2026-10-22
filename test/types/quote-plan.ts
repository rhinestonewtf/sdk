import type {
  IntentDetails,
  PlanExecution,
  PlanLeg,
  QuotePlan,
} from '../../src/index'

declare const plan: QuotePlan
declare const executions: NonNullable<IntentDetails['executions']>

// Executions carry the VM of their leg, so a consumer narrows on it directly.
const leg: PlanLeg = plan.destination
if (leg.execution?.vm === 'evm') {
  const value: bigint | undefined = leg.execution.calls[0]?.value
  void value
}

declare const hyperCore: Extract<PlanExecution, { vm: 'hypercore' }>
// @ts-expect-error settlement is absent when the caller sent no HyperEVM calls
void hyperCore.settlement.calls
if (hyperCore.settlement) {
  const value: bigint | undefined = hyperCore.settlement.calls[0]?.value
  void value
}

const destination = executions.destination
// @ts-expect-error a record may hold no destination execution
void destination.vm
if (destination) {
  const vm: PlanExecution['vm'] = destination.vm
  void vm
}
