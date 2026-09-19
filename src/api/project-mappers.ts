import type {
  SplitIntentsInput,
  SplitIntentsResult,
} from '../clients/orchestrator/public'
import type {
  OrchestratorSplitRequest,
  OrchestratorSplitResult,
} from '../clients/orchestrator/types'
import type {
  IntentStatus,
  TransactionStatus,
} from '../transactions/intents/types'

export function toPublicTransactionStatus(
  status: IntentStatus,
): TransactionStatus {
  return {
    traceId: status.traceId,
    purpose: status.purpose,
    status: status.status,
    ...(status.accounts ? { accounts: [...status.accounts] } : {}),
    operations: [...status.operations],
    ...(status.refunds ? { refunds: [...status.refunds] } : {}),
    ...(status.details ? { details: status.details } : {}),
  }
}

export function toOrchestratorSplitRequest(
  input: SplitIntentsInput,
): OrchestratorSplitRequest {
  return {
    chainId: input.chain.id,
    tokens: input.tokens,
    ...(input.settlementLayers
      ? { settlementLayers: input.settlementLayers }
      : {}),
  }
}

export function toPublicSplitResult(
  result: OrchestratorSplitResult,
): SplitIntentsResult {
  return {
    traceId: result.traceId,
    intents: result.intents.map((intent) => ({ ...intent })),
  }
}
