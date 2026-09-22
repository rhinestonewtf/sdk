import type { Address } from 'viem'
import type { Call } from '../../calls/types'
import { chainIdFromReference, chainVm, formatCaip2 } from '../../chains/caip2'
import { normalizeTokenAddress } from '../../chains/tokens'
import type { NormalizedIntentInput } from '../../clients/orchestrator/normalized'
import type {
  OrchestratorDestination,
  OrchestratorEvmDestinationExecution,
  OrchestratorExecution,
  OrchestratorIntentRequest,
  OrchestratorSponsorship,
  OrchestratorTokenRequest,
} from '../../clients/orchestrator/types'
import {
  type IntentAccountProjection,
  toNormalizedAccount,
  toNormalizedRecipient,
  toWireEvmAccount,
  toWireRecipient,
} from './account'
import { buildIntentSource } from './source'
import type { IntentInput } from './types'

export interface BuiltIntentRequest {
  /** The Caucasus HTTP request. */
  readonly request: OrchestratorIntentRequest
  /**
   * The SDK's normalized sponsorship input, unchanged by the migration. Both
   * views are built from the same resolved transaction so they cannot drift.
   */
  readonly normalized: NormalizedIntentInput
}

export function buildIntentRequest<CompatibilityConfig>(input: {
  readonly transaction: IntentInput<CompatibilityConfig>
  readonly account: IntentAccountProjection
  readonly mockSignatures?: Readonly<Record<`${number}`, `0x${string}`>>
  readonly calls: readonly Call[]
  readonly sourceCalls: Readonly<Record<number, readonly Call[]>>
  readonly providedFunds: Readonly<
    Record<number, Readonly<Record<Address, bigint>>>
  >
}): BuiltIntentRequest {
  const { transaction } = input
  const destinationChainId = chainIdFromReference(transaction.destination)
  const vm = chainVm(transaction.destination)
  const nonEvm = transaction.destination.kind === 'non-evm'
  const executions = input.calls.map(toExecution)
  const sourceExecutions = Object.fromEntries(
    Object.entries(input.sourceCalls).map(([chainId, calls]) => [
      Number(chainId),
      calls.map(toExecution),
    ]),
  )
  const auxiliaryFunds = mergeAuxiliaryFunds(
    transaction.options?.auxiliaryFunds,
    input.providedFunds,
  )
  const tokenRequests: OrchestratorTokenRequest[] =
    transaction.tokenRequests.map((request) => ({
      tokenAddress: normalizeTokenAddress(
        request.token,
        destinationChainId,
        nonEvm,
      ),
      ...(request.amount === undefined ? {} : { amount: request.amount }),
    }))
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

  return {
    request: {
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
      destination: buildDestination({
        vm,
        chainId: formatCaip2(destinationChainId),
        transaction,
        tokenRequests,
        executions,
      }),
      ...(() => {
        const source = buildIntentSource({
          ...(transaction.accountAccessList
            ? { policy: transaction.accountAccessList }
            : {}),
          ...(auxiliaryFunds ? { auxiliaryFunds } : {}),
          ...(Object.keys(sourceExecutions).length > 0
            ? { executions: sourceExecutions }
            : {}),
        })
        return source ? { source } : {}
      })(),
      ...(Object.keys(options).length > 0 ? { options } : {}),
    },
    normalized: {
      account: toNormalizedAccount(input.account, {
        ...(input.mockSignatures
          ? { mockSignatures: input.mockSignatures }
          : {}),
      }),
      destinationChainId,
      destinationExecutions: executions,
      tokenRequests,
      ...(transaction.recipient
        ? { recipient: toNormalizedRecipient(transaction.recipient) }
        : {}),
      ...(transaction.gasLimit === undefined
        ? {}
        : { destinationGasUnits: transaction.gasLimit }),
      ...(transaction.accountAccessList
        ? { accountAccessList: transaction.accountAccessList }
        : {}),
      options: {
        ...transaction.options,
        signatureMode,
        ...(auxiliaryFunds ? { auxiliaryFunds } : {}),
      },
      ...(Object.keys(sourceExecutions).length > 0
        ? { preClaimExecutions: sourceExecutions }
        : {}),
    },
  }
}

function buildDestination<CompatibilityConfig>(input: {
  readonly vm: ReturnType<typeof chainVm>
  readonly chainId: string
  readonly transaction: IntentInput<CompatibilityConfig>
  readonly tokenRequests: readonly OrchestratorTokenRequest[]
  readonly executions: readonly OrchestratorExecution[]
}): OrchestratorDestination {
  const { transaction, chainId, tokenRequests } = input
  const recipient = transaction.recipient
    ? toWireRecipient(transaction.recipient)
    : undefined
  switch (input.vm) {
    case 'evm': {
      const execution = evmExecution(input.executions, transaction.gasLimit)
      return {
        vm: 'evm',
        chainId,
        ...(recipient ? { recipient } : {}),
        tokenRequests,
        ...(execution ? { execution } : {}),
      }
    }
    case 'svm': {
      // An EVM-origin intent delivers tokens to Solana; instructions are a
      // Solana-origin capability and travel their own path.
      return {
        vm: 'svm',
        chainId,
        ...(recipient ? { recipient: { address: recipient.address } } : {}),
        tokenRequests,
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
        recipient: { address: recipient.address },
        tokenRequests,
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
        ...(recipient ? { recipient } : {}),
        tokenRequests,
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
  settings:
    | {
        readonly gas: boolean
        readonly bridgeFees: boolean
        readonly swapFees: boolean
        readonly protocolFees?: boolean
      }
    | undefined,
): OrchestratorSponsorship | undefined {
  // Caucasus renamed the block but kept the categories, including the
  // difference between an explicit `false` and an omitted key.
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

function mergeAuxiliaryFunds(
  configured:
    | Readonly<Record<number, Readonly<Record<Address, bigint>>>>
    | undefined,
  provided: Readonly<Record<number, Readonly<Record<Address, bigint>>>>,
): Readonly<Record<number, Readonly<Record<Address, bigint>>>> | undefined {
  const result: Record<number, Record<Address, bigint>> = {}
  for (const [chainId, balances] of Object.entries(configured ?? {})) {
    result[Number(chainId)] = { ...balances }
  }
  for (const [chainId, balances] of Object.entries(provided)) {
    const target = (result[Number(chainId)] ??= {})
    for (const [token, amount] of Object.entries(balances)) {
      target[token as Address] = (target[token as Address] ?? 0n) + amount
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}
