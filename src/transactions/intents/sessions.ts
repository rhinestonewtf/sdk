import { decodeFunctionData, type Hex, hashStruct, isAddressEqual } from 'viem'
import type { AccountRuntime } from '../../accounts/adapter'
import type { Call } from '../../calls/types'
import { isHyperCoreWireId } from '../../chains/caip2'
import type { EvmChainReference } from '../../chains/types'
import type { SigningRequest } from '../../clients/orchestrator/public'
import {
  hashOpStruct,
  type Permit2ClaimMessage,
} from '../../modules/validators/policies/claim/permit2'
import { buildSmartSessionMockSignature } from '../../modules/validators/smart-sessions/mock-signature'
import {
  buildOneTimeUseBurnOp,
  oneTimeUseIdPolicyAbi,
} from '../../modules/validators/smart-sessions/one-time-use'
import { assertOneTimeUseIdPolicyDeployed } from '../../modules/validators/smart-sessions/policies/addresses'
import {
  permit2ClaimPolicyMatchesMessage,
  selectPermit2ClaimPolicyForMessage,
} from '../../modules/validators/smart-sessions/policies/claim'
import {
  DUMMY_PRECLAIMOP_SELECTOR,
  DUMMY_PRECLAIMOP_TARGET,
} from '../../modules/validators/smart-sessions/resolve'
import type {
  ResolvedSessionSignerSet,
  Session,
} from '../../modules/validators/smart-sessions/types'
import { originChainId } from './origin-chain'
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
  readonly requiredChains?: readonly EvmChainReference[]
  readonly previous?: PreparedIntentSessions
  /** Direct signing has no execution preparation slot. */
  readonly authorizationOnly?: boolean
  readonly authorizationRequests?: readonly SigningRequest[]
  readonly context: Pick<
    IntentWorkflowContext<CompatibilityConfig>,
    'checkpoints'
  >
}): Promise<PreparedIntentSessions | undefined> {
  const selection = input.intent.signers
  if (!selection || selection.kind !== 'smart-session') return undefined
  const executionChains = input.authorizationOnly
    ? []
    : sessionChains(input.intent, input.runtime.identity.address)
  const chains = [
    ...new Map(
      [...executionChains, ...(input.requiredChains ?? [])].map((chain) => [
        chain.id,
        chain,
      ]),
    ).values(),
  ]
  for (const chain of chains) {
    const selected = selection.byChain[chain.id]
    if (!selected)
      throw new Error(
        `No session configured for chain ${chain.id}. Supply an explicit grant for every required authorization chain.`,
      )
    if (selected.session.chain.id !== chain.id)
      throw new Error(
        `Session configured for chain ${chain.id} belongs to chain ${selected.session.chain.id}`,
      )
    if (
      !executionChains.some((candidate) => candidate.id === chain.id) &&
      selected.session.oneTimeUse &&
      !(
        input.authorizationOnly &&
        sourceBurnIsCommitted(
          selected.session,
          input.authorizationRequests ?? [],
        )
      )
    )
      throw new Error(
        `Session for chain ${chain.id} requires a oneTimeUse burn that this authorization-only route cannot execute. Use a compatible grant and prepare a fresh transaction.`,
      )
  }
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
      const previous = input.previous?.byChain[chain.id]
      if (previous) return [chain.id, previous] as const
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
      if (
        !enabled.enabled &&
        !selected.enableData &&
        !executionChains.some((candidate) => candidate.id === chain.id)
      )
        throw new Error(
          `Session for authorization chain ${chain.id} is not enabled. Supply its enable data or enable the grant before preparing a fresh transaction.`,
        )
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
    !input.authorizationOnly &&
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
  const origin =
    !input.authorizationOnly &&
    input.intent.source &&
    byChain[input.intent.source.chain.id]
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
    !input.authorizationOnly && enablingChain.kind === 'evm'
      ? byChain[enablingChain.id]
      : undefined
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
    input.intent.destination.kind === 'evm' &&
    executionChains.some(
      (chain) => chain.caip2 === input.intent.destination.caip2,
    )
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

// Direct signing cannot insert a burn. Only an origin that already signs the
// Permit2 pre-claim burn is evidence; a repeated destination payload is not.
function sourceBurnIsCommitted(
  session: Session,
  requests: readonly SigningRequest[],
): boolean {
  const once = session.oneTimeUse
  if (!once) return false
  const origins = requests.filter(
    (request) =>
      request.purpose === 'originAuthorization' &&
      request.payload.kind === 'eip712' &&
      originChainId(request.payload.typedData) === session.chain.id,
  )
  return (
    origins.length > 0 &&
    origins.every((request) => {
      if (request.payload.kind !== 'eip712') return false
      const typedData = request.payload.typedData
      if (typedData.primaryType !== 'PermitBatchWitnessTransferFrom')
        return false
      // Extra message properties are not necessarily signed. Check the path to
      // the operation and reuse the policy's canonical Op hash for its schema.
      if (
        !typedData.types.PermitBatchWitnessTransferFrom?.some(
          ({ name, type }) => name === 'mandate' && type === 'Mandate',
        ) ||
        !typedData.types.Mandate?.some(
          ({ name, type }) => name === 'originOps' && type === 'Op',
        ) ||
        !typedData.types.PermitBatchWitnessTransferFrom?.some(
          ({ name, type }) => name === 'nonce' && type === 'uint256',
        )
      )
        return false
      try {
        const message = typedData.message as unknown as Permit2ClaimMessage
        const op = message.mandate.originOps
        if (
          hashStruct({
            primaryType: 'Op',
            types: typedData.types,
            data: op,
          }) !== hashOpStruct(op)
        )
          return false
        const policy = selectPermit2ClaimPolicyForMessage(
          session.claimPolicies,
          message,
        )
        if (
          policy &&
          (!permit2ClaimPolicyMatchesMessage(policy, message) ||
            policy.originOps?.some(
              ({ chain, required }) =>
                chain.id === session.chain.id && !required,
            ))
        )
          return false
        return op.ops.some((call) => {
          if (
            !isAddressEqual(call.to, once.policy) ||
            BigInt(call.value) !== 0n
          )
            return false
          const burn = decodeFunctionData({
            abi: oneTimeUseIdPolicyAbi,
            data: call.data,
          })
          return (
            burn.functionName === 'consumeFor' &&
            burn.args[0] === once.id &&
            burn.args[1] === BigInt(message.nonce)
          )
        })
      } catch {
        return false
      }
    })
  )
}

// Virtual venues and other recipients do not host this account's session.
export function sessionChains<CompatibilityConfig>(
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
