import type { Hex } from 'viem'
import type { AccountRuntime } from '../../accounts/adapter'
import type { Call } from '../../calls/types'
import { isHyperCoreWireId } from '../../chains/caip2'
import type { EvmChainReference } from '../../chains/types'
import { buildSmartSessionMockSignature } from '../../modules/validators/smart-sessions/mock-signature'
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
  readonly preClaimCalls: Readonly<Record<number, readonly Call[]>>
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
  const chains = sessionChains(input.intent)
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
      // A one-time-use session must never drop to plain ERC-1271 (mode 1): the
      // executor route's on-chain guard (a `consume` may only name the session's
      // own id) runs via checkAction, which only fires in verify-execution mode
      // (mode 5). An already-enabled, permission-less session would otherwise take
      // mode 1 and skip it. Replay of a burned id is still blocked by the 1271
      // advisory read, but the action-surface guard would be inert — so force it.
      const verifyExecutions =
        !enabled.enabled ||
        selected.session.hasExplicitPermissions ||
        selected.session.oneTimeUse === true
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
  const mockSignatures = Object.fromEntries(
    resolvedEntries.map(([chainId, resolved]) => [
      String(chainId),
      buildSmartSessionMockSignature({
        session: resolved.session,
        environment: input.runtime.construction.sessions.environment,
        chainCount: input.intent.sourceChains?.length ?? 1,
        targetChainId: chainId,
        shape: !resolved.verifyExecutions
          ? 'erc1271'
          : resolved.enableData
            ? 'enable'
            : 'use',
      }),
    ]),
  )
  const preClaimCalls = Object.fromEntries(
    (input.intent.sourceChains ?? []).flatMap((chain) => {
      const resolved = byChain[chain.id]
      return resolved?.verifyExecutions && resolved.enableData
        ? [
            [
              chain.id,
              [
                {
                  target: DUMMY_PRECLAIMOP_TARGET,
                  value: 0n,
                  data: DUMMY_PRECLAIMOP_SELECTOR,
                },
              ],
            ] as const,
          ]
        : []
    }),
  )
  return {
    signatureMode: resolvedEntries.some(([, value]) => value.verifyExecutions)
      ? 5
      : 1,
    byChain,
    mockSignatures,
    preClaimCalls,
  }
}

// Chains a smart-session intent needs an enabled session on: every source, plus
// the destination when the user's own account executes there.
//
// A HyperCore venue is excluded for the same reason it cannot host the account
// runtime: it is EVM-ADDRESSED but virtual, so there is no account there to enable
// a session on, and requiring one would demand a session on chain 1337001/1337002
// that can never exist. Delivery is solver-mediated anyway — the orchestrator
// builds the `depositFor` credit and the recipient never executes — so there is no
// destination-side authorization for a session to grant (RHI-5510).
function sessionChains<CompatibilityConfig>(
  intent: IntentInput<CompatibilityConfig>,
): readonly EvmChainReference[] {
  const chains = new Map(
    (intent.sourceChains ?? []).map((chain) => [chain.id, chain]),
  )
  if (
    intent.destination.kind === 'evm' &&
    !isHyperCoreWireId(intent.destination.id)
  ) {
    chains.set(intent.destination.id, intent.destination)
  }
  return [...chains.values()]
}
