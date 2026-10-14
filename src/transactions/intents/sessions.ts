import type { Hex } from 'viem'
import type { AccountRuntime } from '../../accounts/adapter'
import type { Call } from '../../calls/types'
import { isHyperCoreWireId } from '../../chains/caip2'
import type { EvmChainReference } from '../../chains/types'
import { buildSmartSessionMockSignature } from '../../modules/validators/smart-sessions/mock-signature'
import { buildOneTimeUseBurnOp } from '../../modules/validators/smart-sessions/one-time-use'
import { assertOneTimeUseIdPolicyDeployed } from '../../modules/validators/smart-sessions/policies/addresses'
import {
  DUMMY_PRECLAIMOP_SELECTOR,
  DUMMY_PRECLAIMOP_TARGET,
} from '../../modules/validators/smart-sessions/resolve'
import type { ResolvedSessionSignerSet } from '../../modules/validators/smart-sessions/types'
import type { IntentInput, IntentWorkflowContext } from './types'

export interface PreparedIntentSessions {
  readonly signatureMode: number
  readonly byChain: Readonly<Record<number, ResolvedSessionSignerSet>>
  readonly mockSignatures: Readonly<Record<string, Hex>>
  /** Session-enable pre-claim calls, run on the source chain before any others. */
  readonly preClaimCalls: readonly Call[]
  readonly destinationBurn?: Call
}

export async function prepareIntentSessions<CompatibilityConfig>(input: {
  readonly intent: IntentInput<CompatibilityConfig>
  readonly runtime: AccountRuntime
  readonly context: Pick<
    IntentWorkflowContext<CompatibilityConfig>,
    'checkpoints'
  >
}): Promise<PreparedIntentSessions | undefined> {
  const selection = input.intent.signers
  if (!selection || selection.kind !== 'smart-session') return undefined
  const chains = sessionChains(input.intent, input.runtime.identity.address)
  for (const chain of chains) {
    const once = selection.byChain[chain.id]?.session.oneTimeUse
    if (once?.defaultPolicy)
      assertOneTimeUseIdPolicyDeployed(once.policy, chain.id)
  }
  const resolvedEntries = await Promise.all(
    chains.map(async (chain) => {
      const selected = selection.byChain[chain.id]
      if (!selected) {
        throw new Error(`No session configured for chain ${chain.id}`)
      }
      const checkpointId = `intent-session:${chain.id}:${selected.session.permissionId}`
      const facts = await input.context.checkpoints.read({
        kind: 'session-enabled',
        id: checkpointId,
        chain,
        account: input.runtime.identity.address,
        permissionId: selected.session.permissionId,
      })
      const enabled = facts.find(
        (fact) => fact.kind === 'session-enabled' && fact.id === checkpointId,
      )
      if (enabled?.kind !== 'session-enabled') {
        throw new Error(`Session state for chain ${chain.id} is missing`)
      }
      const verifyExecutions =
        !enabled.enabled ||
        selected.session.hasExplicitPermissions ||
        Boolean(selected.session.oneTimeUse)
      return [
        chain.id,
        {
          kind: 'smart-session' as const,
          session: selected.session,
          ...(enabled.enabled || !selected.enableData
            ? {}
            : { enableData: selected.enableData }),
          verifyExecutions,
        },
      ] as const
    }),
  )
  const byChain = Object.fromEntries(resolvedEntries)
  const forbidsPreClaim = (resolved: ResolvedSessionSignerSet) =>
    resolved.session.claimPolicies.some(({ originOps }) =>
      originOps?.some(
        ({ chain, required }) =>
          !required && chain.id === resolved.session.chain.id,
      ),
    )
  if (
    !input.intent.source &&
    resolvedEntries.some(
      ([, resolved]) =>
        resolved.session.oneTimeUse || forbidsPreClaim(resolved),
    )
  ) {
    throw new Error(
      'This smart session requires an explicit source for its oneTimeUse burn or pre-claim restrictions',
    )
  }
  const origin = input.intent.source && byChain[input.intent.source.chain.id]
  if (
    origin &&
    forbidsPreClaim(origin) &&
    (origin.enableData || input.intent.source?.calls?.length)
  ) {
    throw new Error(
      'The session claim may not carry pre-claim calls: enable it first and omit source calls',
    )
  }
  const mockSignatures = Object.fromEntries(
    resolvedEntries.map(([chainId, resolved]) => [
      String(chainId),
      buildSmartSessionMockSignature({
        session: resolved.session,
        environment: input.runtime.construction.sessions.environment,
        chainCount: 1,
        targetChainId: chainId,
        shape: !resolved.verifyExecutions
          ? 'erc1271'
          : resolved.enableData
            ? 'enable'
            : 'use',
      }),
    ]),
  )
  // The source chain carries the enablement. A source-free intent has no
  // pre-claim slot, so a destination session that still needs enabling is
  // reported for the caller to refuse.
  const enablingChain = input.intent.source?.chain ?? input.intent.destination
  const enabling =
    enablingChain.kind === 'evm' ? byChain[enablingChain.id] : undefined
  const sourceBurn = origin && oneTimeUseBurnCall(origin)
  const preClaimCalls: readonly Call[] = sourceBurn
    ? [sourceBurn]
    : enabling?.verifyExecutions && enabling.enableData
      ? [
          {
            target: DUMMY_PRECLAIMOP_TARGET,
            value: 0n,
            data: DUMMY_PRECLAIMOP_SELECTOR,
          },
        ]
      : []
  const destinationSession =
    input.intent.destination.kind === 'evm'
      ? byChain[input.intent.destination.id]
      : undefined
  const destinationBurn =
    destinationSession &&
    input.intent.destination.kind === 'evm' &&
    input.intent.source?.chain.id !== input.intent.destination.id
      ? oneTimeUseBurnCall(destinationSession)
      : undefined
  return {
    ...(destinationBurn ? { destinationBurn } : {}),
    signatureMode: resolvedEntries.some(([, value]) => value.verifyExecutions)
      ? 5
      : 1,
    byChain,
    mockSignatures,
    preClaimCalls,
  }
}

// The orchestrator stamps the Permit2 witness; executor settlement ignores it.
function oneTimeUseBurnCall(
  resolved: ResolvedSessionSignerSet,
): Call | undefined {
  if (!resolved.session.oneTimeUse) return undefined
  const op = buildOneTimeUseBurnOp({
    ...resolved.session.oneTimeUse,
    route: 'permit2',
  })
  return { target: op.to, value: op.value, data: op.data }
}

// Virtual venues and other recipients do not host this account's session.
function sessionChains<CompatibilityConfig>(
  intent: IntentInput<CompatibilityConfig>,
  account: string,
): readonly EvmChainReference[] {
  const chains = new Map<number, EvmChainReference>()
  if (intent.source) chains.set(intent.source.chain.id, intent.source.chain)
  if (
    intent.destination.kind === 'evm' &&
    !isHyperCoreWireId(intent.destination.id) &&
    (!intent.recipient ||
      intent.recipient.address.toLowerCase() === account.toLowerCase())
  ) {
    chains.set(intent.destination.id, intent.destination)
  }
  return [...chains.values()]
}
