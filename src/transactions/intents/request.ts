import type { Address } from 'viem'
import type { Call } from '../../calls/types'
import { chainIdFromReference, chainVm, formatCaip2 } from '../../chains/caip2'
import { normalizeTokenAddress } from '../../chains/tokens'
import type { SerializedIntentInput } from '../../clients/orchestrator/public'
import { toSponsorshipApprovalInput } from '../../clients/orchestrator/sponsorship-approval'
import type {
  OrchestratorDestination,
  OrchestratorEvmDestinationExecution,
  OrchestratorExecution,
  OrchestratorIntentRequest,
  OrchestratorSource,
  OrchestratorSponsorship,
} from '../../clients/orchestrator/types'
import {
  type IntentAccountProjection,
  toWireEvmAccount,
  toWireRecipient,
} from './account'
import type { IntentInput } from './types'

export interface BuiltIntentRequest {
  /** The singular Caucasus HTTP request. */
  readonly request: OrchestratorIntentRequest
  /**
   * The sponsorship approval input: `request` projected under the approval
   * contract, so the two cannot drift.
   */
  readonly intentInput: SerializedIntentInput
}

export function buildIntentRequest<CompatibilityConfig>(input: {
  readonly transaction: IntentInput<CompatibilityConfig>
  readonly account: IntentAccountProjection
  readonly mockSignatures?: Readonly<Record<`${number}`, `0x${string}`>>
  readonly calls: readonly Call[]
  /** Resolved source calls, in order: smart-session enablement first. */
  readonly sourceCalls: readonly Call[]
  /** What the resolved source calls make available, in `source.token`. */
  readonly providedFunds: bigint
}): BuiltIntentRequest {
  const { transaction } = input
  const destinationChainId = chainIdFromReference(transaction.destination)
  const vm = chainVm(transaction.destination)
  const nonEvm = transaction.destination.kind === 'non-evm'
  const executions = input.calls.map(toExecution)
  const signatureMode = transaction.signatureMode ?? 1

  const sponsorship = toSponsorship(transaction.options?.sponsorSettings)
  const options = {
    ...(transaction.options?.appFees
      ? { appFees: transaction.options.appFees }
      : {}),
    ...(transaction.options?.protocolFees
      ? { protocolFees: transaction.options.protocolFees }
      : {}),
    ...(transaction.options?.customDeadline === undefined
      ? {}
      : { customDeadline: transaction.options.customDeadline }),
    ...(sponsorship ? { sponsorship } : {}),
    ...(transaction.options?.settlementLayers
      ? { settlementLayers: transaction.options.settlementLayers }
      : {}),
    ...(transaction.options?.quoters
      ? { quoters: transaction.options.quoters }
      : {}),
  }
  const source = buildSource(
    transaction,
    input.sourceCalls.map(toExecution),
    input.providedFunds,
  )

  const request: OrchestratorIntentRequest = {
    account: {
      evm: toWireEvmAccount(input.account, {
        signatureMode,
        ...(input.mockSignatures
          ? {
              mockSignaturesByChain: mapMockSignatures(input.mockSignatures),
            }
          : {}),
      }),
    },
    ...(source ? { source } : {}),
    destination: buildDestination({
      vm,
      chainId: formatCaip2(destinationChainId),
      transaction,
      ...(transaction.token === undefined
        ? {}
        : {
            token: normalizeTokenAddress(
              transaction.token,
              destinationChainId,
              nonEvm,
            ),
          }),
      executions,
    }),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  }
  return { request, intentInput: toSponsorshipApprovalInput(request) }
}

function buildSource<CompatibilityConfig>(
  transaction: IntentInput<CompatibilityConfig>,
  calls: readonly OrchestratorExecution[],
  providedFunds: bigint,
): OrchestratorSource | undefined {
  const source = transaction.source
  if (!source) {
    // Checked by the facade already; a request that loses its source calls here
    // would quote an execution the caller did not ask for.
    if (calls.length > 0) {
      throw new Error('Source calls need a source chain to run on')
    }
    return undefined
  }
  const auxiliaryFunds = (source.auxiliaryFunds ?? 0n) + providedFunds
  return {
    vm: 'evm',
    chainId: formatCaip2(source.chain.id),
    token: normalizeTokenAddress(source.token, source.chain.id, false),
    ...(source.maxAmount === undefined ? {} : { maxAmount: source.maxAmount }),
    ...(auxiliaryFunds > 0n ? { auxiliaryFunds } : {}),
    ...(calls.length > 0 ? { execution: { calls } } : {}),
  }
}

function buildDestination<CompatibilityConfig>(input: {
  readonly vm: ReturnType<typeof chainVm>
  readonly chainId: string
  readonly transaction: IntentInput<CompatibilityConfig>
  readonly token?: string
  readonly executions: readonly OrchestratorExecution[]
}): OrchestratorDestination {
  const { transaction, chainId } = input
  const delivery = {
    ...(input.token === undefined ? {} : { token: input.token }),
    ...(transaction.amount === undefined ? {} : { amount: transaction.amount }),
  }
  const recipient = transaction.recipient
    ? toWireRecipient(transaction.recipient)
    : undefined
  switch (input.vm) {
    case 'evm': {
      const execution = evmExecution(input.executions, transaction.gasLimit)
      return {
        vm: 'evm',
        chainId,
        ...(delivery as { token?: Address; amount?: bigint }),
        ...(recipient ? { recipient } : {}),
        ...(execution ? { execution } : {}),
      }
    }
    case 'svm': {
      // An EVM-origin intent delivers tokens to Solana; instructions are a
      // Solana-origin capability and travel their own path.
      return {
        vm: 'svm',
        chainId,
        ...delivery,
        ...(recipient ? { recipient: { address: recipient.address } } : {}),
      }
    }
    case 'tvm':
    case 'stellar': {
      if (!recipient) {
        throw new Error(
          `An intent to ${chainId} requires an explicit recipient: the account holds no ${input.vm} identity`,
        )
      }
      return {
        vm: input.vm,
        chainId,
        ...delivery,
        recipient: { address: recipient.address },
      }
    }
    case 'hypercore': {
      const action = transaction.options?.hyperCore?.action
      // The actions run on HyperCore; the caller's calls are the HyperEVM
      // transaction that settles them, which is a different chain and a
      // different execution block.
      const settlement = evmExecution(input.executions, transaction.gasLimit)
      const execution =
        action || settlement
          ? {
              ...(action ? { actions: [action] } : {}),
              ...(settlement ? { settlement } : {}),
            }
          : undefined
      return {
        vm: 'hypercore',
        chainId,
        ...delivery,
        ...(recipient ? { recipient } : {}),
        ...(execution ? { execution } : {}),
      }
    }
  }
}

function evmExecution(
  calls: readonly OrchestratorExecution[],
  gasLimit: bigint | undefined,
): OrchestratorEvmDestinationExecution | undefined {
  // Omitted rather than sent empty: an execution block with no calls is not the
  // same request as a plain delivery.
  if (calls.length === 0 && gasLimit === undefined) return undefined
  return {
    calls,
    ...(gasLimit === undefined ? {} : { gasLimit }),
  }
}

function toSponsorship(
  settings: NonNullable<IntentInput['options']>['sponsorSettings'],
): OrchestratorSponsorship | undefined {
  // Copied category by category, keeping an explicit `false` distinct from an
  // omitted key.
  return settings ? { ...settings } : undefined
}

function mapMockSignatures(
  input: Readonly<Record<`${number}`, `0x${string}`>>,
): Readonly<Record<string, `0x${string}`>> {
  return Object.fromEntries(
    Object.entries(input).map(([chainId, signature]) => [
      formatCaip2(Number(chainId)),
      signature,
    ]),
  )
}

export function toExecution(call: Call): OrchestratorExecution {
  return { to: call.target, value: call.value, data: call.data }
}
