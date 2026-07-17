import type { Call } from '../../calls/types'
import { chainIdFromReference } from '../../chains/caip2'
import { sharedChainCatalog } from '../../chains/catalog'
import { normalizeTokenAddress } from '../../chains/tokens'
import type {
  OrchestratorAccount,
  OrchestratorExecution,
  OrchestratorIntentRequest,
} from '../../clients/orchestrator/types'
import { projectIntentRecipient } from './account'
import type { IntentInput } from './types'

export function buildIntentRequest<CompatibilityConfig>(input: {
  readonly transaction: IntentInput<CompatibilityConfig>
  readonly account: OrchestratorAccount
  readonly calls: readonly Call[]
  readonly sourceCalls: Readonly<Record<number, readonly Call[]>>
  readonly providedFunds: Readonly<
    Record<number, Readonly<Record<`0x${string}`, bigint>>>
  >
}): OrchestratorIntentRequest {
  const destinationChainId = chainIdFromReference(input.transaction.destination)
  const nonEvm = input.transaction.destination.kind === 'non-evm'
  const auxiliaryFunds = mergeAuxiliaryFunds(
    input.transaction.options?.auxiliaryFunds,
    input.providedFunds,
  )
  return {
    account: input.account,
    destinationChainId,
    destinationExecutions: input.calls.map(toExecution),
    tokenRequests: input.transaction.tokenRequests.map((request) => ({
      tokenAddress: normalizeTokenAddress(
        sharedChainCatalog,
        request.token,
        destinationChainId,
        nonEvm,
      ),
      ...(request.amount === undefined ? {} : { amount: request.amount }),
    })),
    ...(input.transaction.recipient
      ? {
          recipient: projectIntentRecipient(
            input.transaction.recipient,
            input.transaction.destination,
          ),
        }
      : {}),
    ...(input.transaction.gasLimit === undefined
      ? {}
      : { destinationGasUnits: input.transaction.gasLimit }),
    ...(input.transaction.accountAccessList
      ? { accountAccessList: input.transaction.accountAccessList }
      : {}),
    options: {
      ...input.transaction.options,
      signatureMode: input.transaction.signatureMode ?? 1,
      ...(auxiliaryFunds ? { auxiliaryFunds } : {}),
    },
    ...(Object.keys(input.sourceCalls).length > 0
      ? {
          preClaimExecutions: Object.fromEntries(
            Object.entries(input.sourceCalls).map(([chainId, calls]) => [
              Number(chainId),
              calls.map(toExecution),
            ]),
          ),
        }
      : {}),
  }
}

function toExecution(call: Call): OrchestratorExecution {
  return { to: call.target, value: call.value, data: call.data }
}

function mergeAuxiliaryFunds(
  configured:
    | Readonly<Record<number, Readonly<Record<`0x${string}`, bigint>>>>
    | undefined,
  provided: Readonly<Record<number, Readonly<Record<`0x${string}`, bigint>>>>,
):
  | Readonly<Record<number, Readonly<Record<`0x${string}`, bigint>>>>
  | undefined {
  const result: Record<number, Record<`0x${string}`, bigint>> = {}
  for (const [chainId, balances] of Object.entries(configured ?? {})) {
    result[Number(chainId)] = { ...balances }
  }
  for (const [chainId, balances] of Object.entries(provided)) {
    const target = (result[Number(chainId)] ??= {})
    for (const [token, amount] of Object.entries(balances)) {
      target[token as `0x${string}`] =
        (target[token as `0x${string}`] ?? 0n) + amount
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}
