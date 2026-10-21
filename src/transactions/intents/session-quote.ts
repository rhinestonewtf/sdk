import type { Call } from '../../calls/types'
import { formatCaip2 } from '../../chains/caip2'
import type { OrchestratorIntentRequest } from '../../clients/orchestrator/types'
import { constrainSessionIntent } from './session-routing'
import type { PreparedIntentSessions } from './sessions'
import type { IntentInput } from './types'

function canonical(value: unknown): string {
  return JSON.stringify(value, (_, item) => {
    if (typeof item === 'bigint') return item.toString()
    if (item && typeof item === 'object' && !Array.isArray(item))
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, item[key]]),
      )
    return item
  })
}

export function sameSessionRequest(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right)
}

/** An exact quote cannot acquire new simulation inputs or execution at signing time. */
export function assertSessionQuoteCompatible<C>(input: {
  readonly intent: IntentInput<C>
  readonly account: string
  readonly request: OrchestratorIntentRequest
  readonly sessions: PreparedIntentSessions
}): void {
  const { sessions, request } = input
  if (!request.account || !request.destination)
    throw new Error(
      'This exact quote has no complete persisted request. Prepare a fresh transaction before signing with smart sessions.',
    )
  const constrained = constrainSessionIntent(
    input.intent,
    input.account,
    Object.keys(sessions.byChain).map(Number),
  )
  const evm = request.account.evm
  const mocks = Object.fromEntries(
    Object.entries(sessions.mockSignatures).map(([chainId, signature]) => [
      formatCaip2(Number(chainId)),
      signature,
    ]),
  )
  const prefixMatches = (
    required: readonly Call[],
    quoted: readonly {
      readonly to: string
      readonly value: bigint
      readonly data: string
    }[],
  ) =>
    required.every((call, index) => {
      const actual = quoted[index]
      return (
        actual &&
        actual.to.toLowerCase() === call.target.toLowerCase() &&
        sameSessionRequest(actual.value, call.value) &&
        actual.data.toLowerCase() === call.data.toLowerCase()
      )
    })
  const sourceCalls =
    request.source?.vm === 'evm' ? (request.source.execution?.calls ?? []) : []
  const destinationCalls =
    request.destination.vm === 'evm'
      ? (request.destination.execution?.calls ?? [])
      : []
  if (
    evm?.signatureMode !== sessions.signatureMode ||
    !sameSessionRequest(
      evm && 'simulation' in evm
        ? evm.simulation?.mockSignaturesByChain
        : undefined,
      mocks,
    ) ||
    !sameSessionRequest(
      request.options?.settlementLayers,
      constrained.options?.settlementLayers,
    ) ||
    !sameSessionRequest(
      request.options?.quoters,
      constrained.options?.quoters,
    ) ||
    (request.source?.vm === 'evm' &&
      !sameSessionRequest(
        request.source.maxAmount,
        constrained.source?.maxAmount,
      )) ||
    !prefixMatches(sessions.preClaimCalls, sourceCalls) ||
    (sessions.destinationBurn &&
      input.intent.calls.length > 0 &&
      !prefixMatches([sessions.destinationBurn], destinationCalls))
  )
    throw new Error(
      'This exact quote is incompatible with the required smart sessions. Prepare a fresh transaction with the explicit grants; an existing quote cannot be refreshed during signing.',
    )
}
