import { hashTypedData, keccak256, stringToHex } from 'viem'
import type { AccountRuntime } from '../../accounts/adapter'
import { resolveCalls } from '../../calls/resolve'
import type { Call } from '../../calls/types'
import { chainIdFromReference, toEvmChainReference } from '../../chains/caip2'
import type { EvmChainReference } from '../../chains/types'
import { defineValidator } from '../../modules/validators/definition'
import type { ResolvedSessionSignerSet } from '../../modules/validators/smart-sessions/types'
import type { IntentSigningInput } from '../../signing/intent-plans/types'
import { signingTopology } from '../../signing/plan'
import { projectIntentAccount } from './account'
import { normalizeIntentTypedData } from './normalize'
import { selectIntentQuote } from './quotes'
import { buildIntentRequest } from './request'
import { prepareIntentSessions } from './sessions'
import type {
  IntentInput,
  IntentWorkflowContext,
  PreparedIntent,
} from './types'

export async function prepareIntent<CompatibilityConfig>(
  context: IntentWorkflowContext<CompatibilityConfig>,
  input: IntentInput<CompatibilityConfig>,
): Promise<PreparedIntent<CompatibilityConfig>> {
  const accountChain = selectAccountChain(input)
  const runtime = await context.account.forChain(accountChain)
  const calls = await resolveDestinationCalls(context, input, runtime)
  const source = await resolveSourceCalls(context, input, runtime)
  const sessions = await prepareIntentSessions({
    intent: input,
    runtime,
    context,
  })
  const request = buildIntentRequest({
    transaction: sessions
      ? { ...input, signatureMode: sessions.signatureMode }
      : input,
    account: {
      ...projectIntentAccount({
        runtime,
        setupOverride: input.accountSetupOverride,
      }),
      ...(sessions ? { mockSignatures: sessions.mockSignatures } : {}),
    },
    calls,
    sourceCalls: mergeSourceCalls(sessions?.preClaimCalls, source.calls),
    providedFunds: source.providedFunds,
  })
  const response = await context.quoteClient.createQuote(request)
  const quote = normalizeQuote(selectIntentQuote(response.routes))
  const quotes = response.routes.map((candidate) =>
    candidate.intentId === quote.intentId ? quote : normalizeQuote(candidate),
  )
  return {
    traceId: response.traceId,
    input,
    request,
    quote,
    quotes,
    signing: buildIntentSigningInput(
      runtime,
      quote,
      sessions?.byChain,
      input.destination.kind === 'evm' ? input.destination : undefined,
    ),
    accountChain,
    ...(sessions
      ? {
          resolvedSessions: sessions.byChain,
          sessionEnvironment: runtime.construction.sessions.environment,
        }
      : {}),
  }
}

function selectAccountChain<CompatibilityConfig>(
  input: IntentInput<CompatibilityConfig>,
): EvmChainReference {
  if (input.destination.kind === 'evm') return input.destination
  const source = input.sourceChains?.at(-1)
  if (!source) {
    throw new Error('A non-EVM intent requires at least one EVM source chain')
  }
  return source
}

async function resolveDestinationCalls<CompatibilityConfig>(
  context: IntentWorkflowContext<CompatibilityConfig>,
  input: IntentInput<CompatibilityConfig>,
  runtime: AccountRuntime,
): Promise<readonly Call[]> {
  if (input.destination.kind === 'non-evm') {
    if (input.calls.length > 0) {
      throw new Error(
        `Destination calls are not supported for ${input.destination.caip2}`,
      )
    }
    return []
  }
  return resolveCalls(input.calls, {
    account: runtime.identity.address,
    chain: input.destination,
    config: context.compatibilityConfig,
  })
}

async function resolveSourceCalls<CompatibilityConfig>(
  context: IntentWorkflowContext<CompatibilityConfig>,
  input: IntentInput<CompatibilityConfig>,
  runtime: AccountRuntime,
): Promise<{
  readonly calls: Readonly<Record<number, readonly Call[]>>
  readonly providedFunds: Readonly<
    Record<number, Readonly<Record<`0x${string}`, bigint>>>
  >
}> {
  const allowed = new Map<number, EvmChainReference>(
    (input.sourceChains ?? []).map((chain) => [chain.id, chain]),
  )
  if (input.destination.kind === 'evm') {
    allowed.set(input.destination.id, input.destination)
  }
  const calls: Record<number, readonly Call[]> = {}
  const providedFunds: Record<number, Record<`0x${string}`, bigint>> = {}
  for (const [chainIdValue, sourceCalls] of Object.entries(
    input.sourceCalls ?? {},
  )) {
    const chainId = Number(chainIdValue)
    const chain = allowed.get(chainId)
    if (!chain) throw new Error(`Invalid source calls chain ${chainId}`)
    calls[chainId] = await resolveCalls(
      sourceCalls.map(({ call }) => call),
      {
        account: runtime.identity.address,
        chain,
        config: context.compatibilityConfig,
      },
    )
    for (const sourceCall of sourceCalls) {
      for (const provided of sourceCall.provides ?? []) {
        const balances = (providedFunds[chainId] ??= {})
        balances[provided.token] =
          (balances[provided.token] ?? 0n) + provided.amount
      }
    }
  }
  return { calls, providedFunds }
}

function normalizeQuote(
  quote: PreparedIntent['quote'],
): PreparedIntent['quote'] {
  return {
    ...quote,
    signData: {
      origin: quote.signData.origin.map(normalizeIntentTypedData),
      destination: normalizeIntentTypedData(quote.signData.destination),
      ...(quote.signData.targetExecution
        ? {
            targetExecution: normalizeIntentTypedData(
              quote.signData.targetExecution,
            ),
          }
        : {}),
    },
  }
}

export function buildIntentSigningInput(
  runtime: AccountRuntime,
  quote: PreparedIntent['quote'],
  sessions?: PreparedIntent['resolvedSessions'],
  destination?: EvmChainReference,
): IntentSigningInput {
  const sessionTopology = sessions
    ? signingTopology(
        defineValidator(
          requireSession(sessions).session.owners,
          'smart-session-validator',
        ),
      )
    : undefined
  const topology = sessionTopology
    ? sessionTopology
    : runtime.construction.owner
      ? signingTopology(runtime.construction.owner)
      : {
          configuredTopology: {
            rootValidatorId: 'eoa',
            validators: [],
            threshold: 1,
          },
          effectiveSelection: {
            validatorIds: [],
            signerIds: runtime.construction.eoa
              ? [`ecdsa:${runtime.construction.eoa.address.toLowerCase()}`]
              : [],
            threshold: 1,
          },
        }
  const origins = quote.signData.origin.map((typedData, index) => ({
    id: hashTypedData(typedData),
    chain: toEvmChainReference(Number(typedData.domain?.chainId)),
    role: 'origin' as const,
    typedData,
    usage: 'intent-origin' as const,
    artifactId: `origin-${index}`,
  }))
  if (origins.length === 0)
    throw new Error('Intent quote has no origin payloads')
  const lastOrigin = origins.at(-1)
  if (!lastOrigin) throw new Error('Intent quote has no origin payloads')
  const destinationChain = destination
  const destinationSession = destinationChain
    ? sessions?.[destinationChain.id]
    : undefined
  const destinationPayload = destinationChain
    ? {
        id: hashTypedData(quote.signData.destination),
        chain: toEvmChainReference(
          Number(
            quote.signData.destination.domain?.chainId ?? destinationChain.id,
          ),
        ),
        role: 'destination' as const,
        typedData: quote.signData.destination,
        usage: 'intent-destination' as const,
      }
    : undefined
  const targetExecution = quote.signData.targetExecution
  const targetCandidate = targetExecution
    ? {
        id: hashTypedData(targetExecution),
        chain: toEvmChainReference(
          Number(
            targetExecution.domain?.chainId ??
              chainIdFromReference(runtime.construction.chain),
          ),
        ),
        role: 'target' as const,
        typedData: targetExecution,
        usage: 'intent-target' as const,
      }
    : undefined
  const targetSession = targetCandidate
    ? sessions?.[targetCandidate.chain.id]
    : undefined
  const target =
    targetCandidate && targetSession?.verifyExecutions
      ? targetCandidate
      : undefined
  return {
    id: keccak256(stringToHex(quote.intentId)),
    preparedSignatureMode: sessions
      ? Object.values(sessions).some(({ verifyExecutions }) => verifyExecutions)
        ? 'session-with-execution-verification'
        : 'session'
      : 'default',
    ...topology,
    origins: origins.map(({ artifactId: _artifactId, ...origin }) => origin),
    destination:
      sessions && destinationSession && destinationPayload
        ? {
            mode: 'sign',
            payload: destinationPayload,
            artifactId: 'destination',
          }
        : {
            mode: 'reuse-origin',
            artifactId: 'destination',
            originArtifactId: lastOrigin.artifactId,
            selection: sessions ? 'pre-claim' : 'whole',
          },
    ...(target ? { target } : {}),
    artifacts: [
      ...origins.map((origin) => ({
        id: origin.artifactId,
        usage: 'intent-origin' as const,
        payloadId: origin.id,
        cardinality: 'one' as const,
        shape: sessions?.[origin.chain.id]?.verifyExecutions
          ? ('session-claims' as const)
          : ('hex' as const),
        exposedForIndependentSigning: !sessions,
      })),
      {
        id: 'destination',
        usage: 'intent-destination' as const,
        payloadId: hashTypedData(quote.signData.destination),
        cardinality: 'one' as const,
        shape: 'hex' as const,
        exposedForIndependentSigning: false,
      },
      ...(target
        ? [
            {
              id: 'target',
              usage: 'intent-target' as const,
              payloadId: target.id,
              cardinality: 'one' as const,
              shape: 'hex' as const,
              exposedForIndependentSigning: false,
            },
          ]
        : []),
    ],
  }
}

function requireSession(
  sessions: Readonly<Record<number, ResolvedSessionSignerSet>>,
): ResolvedSessionSignerSet {
  const session = Object.values(sessions)[0]
  if (!session) throw new Error('Intent session selection is empty')
  return session
}

function mergeSourceCalls(
  first: Readonly<Record<number, readonly Call[]>> | undefined,
  second: Readonly<Record<number, readonly Call[]>>,
): Readonly<Record<number, readonly Call[]>> {
  const result: Record<number, readonly Call[]> = { ...first }
  for (const [chainId, calls] of Object.entries(second)) {
    result[Number(chainId)] = [...(result[Number(chainId)] ?? []), ...calls]
  }
  return result
}
