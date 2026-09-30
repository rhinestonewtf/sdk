import {
  type Address,
  type Hex,
  hashTypedData,
  keccak256,
  stringToHex,
} from 'viem'
import type { AccountRuntime } from '../../accounts/adapter'
import { resolveCalls } from '../../calls/resolve'
import type { Call } from '../../calls/types'
import { isHyperCoreWireId, toEvmChainReference } from '../../chains/caip2'
import type { EvmChainReference } from '../../chains/types'
import type {
  SigningRequest,
  SigningRequestPurpose,
} from '../../clients/orchestrator/public'
import { isSponsoredIntentInput } from '../../clients/orchestrator/sponsorship-approval'
import { UnsupportedAccountCapabilityError } from '../../errors/capability'
import {
  InvalidSourceCallsError,
  UnsupportedSigningRequestError,
} from '../../errors/execution'
import { defineValidator } from '../../modules/validators/definition'
import { ecdsaSignerId } from '../../modules/validators/signer-id'
import type { ResolvedSessionSignerSet } from '../../modules/validators/smart-sessions/types'
import type {
  IntentSigningInput,
  IntentSigningRequest,
} from '../../signing/intent-plans/types'
import { signingTopology } from '../../signing/plan'
import type { SignatureUsage } from '../../signing/types'
import { projectIntentAccount } from './account'
import { normalizeIntentQuote } from './normalize'
import { originChainId } from './origin-chain'
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
  const preClaimCalls = sessions?.preClaimCalls ?? []
  if (preClaimCalls.length > 0 && !input.source) {
    throw new UnsupportedAccountCapabilityError(
      'Enabling the smart session runs a call on the source chain before the claim, and this transaction names no `source`. Add a `source`, or enable the session first.',
      { field: 'source' },
    )
  }
  const ownerSelection =
    input.signers?.kind === 'owner' ? input.signers : undefined
  const { request, intentInput } = buildIntentRequest({
    transaction: sessions
      ? { ...input, signatureMode: sessions.signatureMode }
      : input,
    account: projectIntentAccount({
      runtime,
      setupOverride: input.accountSetupOverride,
      ...(input.eip7702InitSignature
        ? { eip7702InitSignature: input.eip7702InitSignature }
        : {}),
    }),
    ...(sessions ? { mockSignatures: sessions.mockSignatures } : {}),
    calls,
    sourceCalls: [...preClaimCalls, ...source.calls],
    providedFunds: source.providedFunds,
  })
  const response = await context.quoteClient.createQuote(request, {
    intentInput,
    sponsored: isSponsoredIntentInput(intentInput),
  })
  const quote = normalizeIntentQuote(selectIntentQuote(response.routes))
  const quotes = response.routes.map((candidate) =>
    candidate.intentId === quote.intentId
      ? quote
      : normalizeIntentQuote(candidate),
  )
  return {
    traceId: response.traceId,
    input,
    request,
    intentInput,
    quote,
    quotes,
    signing: buildIntentSigningInput(
      runtime,
      quote,
      sessions?.byChain,
      ownerSelection?.validator,
      ownerSelection?.signerIds,
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

// The chain whose runtime hosts the account: identity, address derivation, and
// the RPC reads that follow. The destination serves when it is a real execution
// chain, and otherwise a source chain does.
//
// `kind === 'evm'` alone is not that test. HyperCore is EVM-ADDRESSED — hex
// recipients, EIP-712 — while being virtual: it has no RPC of its own and hosts
// no accounts, so materializing a runtime on it asks viem for a transport that
// cannot exist. That went unnoticed while HyperCore was chain 1337, because viem
// ships a `Localhost` chain with that exact id and quietly supplied
// `http://127.0.0.1:8545`; the venue ids have no viem chain, so the synthesised
// one has empty `rpcUrls` and the call fails with `UrlRequiredError` (RHI-5510).
function selectAccountChain<CompatibilityConfig>(
  input: IntentInput<CompatibilityConfig>,
): EvmChainReference {
  if (
    input.destination.kind === 'evm' &&
    !isHyperCoreWireId(input.destination.id)
  ) {
    return input.destination
  }
  if (!input.source) {
    throw new Error(
      `An intent to ${input.destination.caip2} requires an EVM source chain: the destination hosts no account runtime`,
    )
  }
  return input.source.chain
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
  readonly calls: readonly Call[]
  readonly providedFunds: bigint
}> {
  const source = input.source
  if (!source?.calls?.length) return { calls: [], providedFunds: 0n }
  const calls = await resolveCalls(
    source.calls.map(({ call }) => call),
    {
      account: runtime.identity.address,
      chain: source.chain,
      config: context.compatibilityConfig,
    },
  )
  let providedFunds = 0n
  for (const sourceCall of source.calls) {
    for (const provided of sourceCall.provides ?? []) {
      if (provided.token.toLowerCase() !== source.token.toLowerCase()) {
        throw new InvalidSourceCallsError({ chainId: source.chain.id })
      }
      providedFunds += provided.amount
    }
  }
  return { calls, providedFunds }
}

// Only read for EIP-712 requests, which produce a signing artifact. A
// delegation is answered by the 7702 signer and has no artifact, so its entry
// exists for exhaustiveness rather than because anything looks it up.
const PURPOSE_USAGE = {
  originAuthorization: 'intent-origin',
  destinationAuthorization: 'intent-destination',
  targetExecutionAuthorization: 'intent-target',
  delegationAuthorization: 'intent-origin',
} as const satisfies Record<SigningRequestPurpose, SignatureUsage>

/**
 * Classifies each quote signing request for local execution, preserving the
 * quoted order as the identity of every authorisation.
 */
function classifyRequests(
  requests: readonly SigningRequest[],
  sessions: PreparedIntent['resolvedSessions'],
  binding: SigningRequestBinding,
): readonly IntentSigningRequest[] {
  const signed: {
    readonly digest: Hex
    readonly identity: string
    readonly artifactId: string
    readonly shape: 'hex' | 'session-claims'
  }[] = []
  return requests.map((request, index): IntentSigningRequest => {
    const purpose = request.purpose
    assertRequestIsOurs(request, index, binding)
    switch (request.payload.kind) {
      case 'eip712': {
        const typedData = request.payload.typedData
        const chain = toEvmChainReference(originChainId(typedData))
        const digest = hashTypedData(typedData)
        const identity = signerIdentity(request)
        const artifactId = `request-${index}`
        const session = sessions?.[chain.id]
        const shape =
          purpose === 'originAuthorization' && session?.verifyExecutions
            ? ('session-claims' as const)
            : ('hex' as const)
        // Reuse is decided by what is actually being authorised, never by role:
        // the same account signing the same payload under the same authority
        // produces the same bytes, and anything else is a distinct ceremony.
        const match = signed.find(
          (candidate) =>
            candidate.digest === digest && candidate.identity === identity,
        )
        if (!match) {
          signed.push({ digest, identity, artifactId, shape })
        }
        return {
          kind: 'eip712',
          index,
          purpose,
          artifactId,
          signatureFormat: request.payload.signatureFormat,
          payload: {
            id: digest,
            chain,
            typedData,
            usage: PURPOSE_USAGE[purpose],
          },
          shape: match ? 'hex' : shape,
          ...(match
            ? {
                reuse: {
                  artifactId: match.artifactId,
                  selection:
                    match.shape === 'session-claims'
                      ? ('pre-claim' as const)
                      : ('whole' as const),
                },
              }
            : {}),
          // Every slot the owners have to sign themselves, which is every
          // non-reused payload: a target execution authorization is as much
          // theirs as an origin one, and dropping it here would leave the
          // proof vector permanently short.
          exposedForIndependentSigning: !sessions && !match,
        }
      }
      case 'eip7702':
        return {
          kind: 'eip7702',
          index,
          purpose,
          chainId: request.payload.authorization.chainId,
          contract: request.payload.authorization.address,
        }
      case 'personalSign':
        return {
          kind: 'personalSign',
          index,
          purpose,
          message: request.payload.message.value,
        }
      default:
        return {
          kind: 'unsupported',
          index,
          purpose,
          payloadKind: request.payload.kind,
        }
    }
  })
}

/** The account and key this SDK can actually sign for. */
interface SigningRequestBinding {
  readonly address: Address
  readonly eoa?: Address
  readonly signsRawKey: boolean
}

function signingRequestBinding(runtime: AccountRuntime): SigningRequestBinding {
  return {
    address: runtime.identity.address,
    ...(runtime.construction.eoa
      ? { eoa: runtime.construction.eoa.address }
      : {}),
    // Only the EOA adapter passes the signer's bytes through untouched; every
    // smart account wraps them in its validator envelope.
    signsRawKey: runtime.identity.definition.kind === 'eoa',
  }
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

/**
 * Refuses a signing request that is not this account's to answer.
 *
 * A quote can legitimately name another subject — a configured recipient that
 * adopts EIP-7702 gets its own delegation request — and signing it with our
 * key would produce a proof the orchestrator rejects at recovery, after the
 * user has already been prompted.
 */
function assertRequestIsOurs(
  request: SigningRequest,
  index: number,
  binding: SigningRequestBinding,
): void {
  const refuse = (reason: string) => {
    throw new UnsupportedSigningRequestError({
      index,
      payloadKind: request.payload.kind,
      reason,
    })
  }
  if (request.payload.kind !== 'eip712' && request.payload.kind !== 'eip7702') {
    return
  }
  if (request.account.vm !== 'evm') {
    refuse(
      `Signing request ${index} is for a ${request.account.vm} account, which this EVM account cannot sign for.`,
    )
    return
  }
  if (!sameAddress(request.account.address, binding.address)) {
    refuse(
      `Signing request ${index} names account ${request.account.address}, not ${binding.address}. This SDK only signs for its own account.`,
    )
  }
  if (request.payload.kind === 'eip7702') {
    if (
      request.authority.kind !== 'secp256k1' ||
      (binding.eoa && !sameAddress(request.authority.address, binding.eoa))
    ) {
      refuse(
        `Signing request ${index} asks ${authorityLabel(request.authority)} for an EIP-7702 delegation; this account delegates with ${binding.eoa ?? 'no EOA'}.`,
      )
    }
    return
  }
  const wantsRawKey = request.payload.signatureFormat === 'secp256k1'
  if (wantsRawKey !== binding.signsRawKey) {
    refuse(
      `Signing request ${index} asks for a \`${request.payload.signatureFormat}\` signature, which this account does not produce.`,
    )
  }
}

function authorityLabel(authority: SigningRequest['authority']): string {
  return authority.kind === 'swigRole'
    ? `Swig role ${authority.roleId}`
    : authority.address
}

/**
 * Who has to produce the signature, and for which account. Two requests with
 * the same payload but different authorities are different authorisations.
 */
function signerIdentity(request: SigningRequest): string {
  const account =
    request.account.vm === 'evm'
      ? `evm:${request.account.address.toLowerCase()}`
      : `svm:${request.account.wallet}`
  const signer = request.authority
  const authority =
    signer.kind === 'swigRole'
      ? `swigRole:${signer.roleId}:${(
          signer.authority.kind === 'secp256k1'
            ? signer.authority.address
            : signer.authority.publicKey
        ).toLowerCase()}`
      : `${signer.kind}:${signer.address.toLowerCase()}`
  return `${account}|${authority}|${
    request.payload.kind === 'eip712' ? request.payload.signatureFormat : ''
  }`
}

const EVM_SIGNABLE_PAYLOADS = new Set(['eip712', 'eip7702'])

/**
 * Refuses a quote asking for a payload an EVM account runtime cannot produce —
 * a WebAuthn challenge, or the personal-sign spend a Swig origin needs.
 *
 * Checked before any account state is read, so an unsupported quote fails
 * immediately rather than after an RPC round trip, and long before the ordered
 * proof vector is half built.
 */
export function assertSupportedSigningRequests(
  requests: readonly SigningRequest[],
): void {
  const index = requests.findIndex(
    ({ payload }) => !EVM_SIGNABLE_PAYLOADS.has(payload.kind),
  )
  if (index === -1) return
  throw new UnsupportedSigningRequestError({
    index,
    payloadKind: requests[index]!.payload.kind,
  })
}

export function buildIntentSigningInput(
  runtime: AccountRuntime,
  quote: PreparedIntent['quote'],
  sessions?: PreparedIntent['resolvedSessions'],
  ownerValidator?: import('../../modules/validators/types').ResolvedValidatorDefinition,
  selectedSignerIds?: readonly string[],
): IntentSigningInput {
  assertSupportedSigningRequests(quote.signingRequests)
  const requests = classifyRequests(
    quote.signingRequests,
    sessions,
    signingRequestBinding(runtime),
  )
  const sessionTopology = sessions
    ? signingTopology(
        defineValidator(
          requireSession(sessions).session.owners,
          'smart-session-validator',
        ),
      )
    : undefined
  const selectedOwner = ownerValidator ?? runtime.construction.owner
  const topology = sessionTopology
    ? sessionTopology
    : selectedOwner
      ? signingTopology(selectedOwner, selectedSignerIds)
      : {
          configuredTopology: {
            rootValidatorId: 'eoa',
            validators: [],
            threshold: 1,
          },
          effectiveSelection: {
            validatorIds: [],
            signerIds: runtime.construction.eoa
              ? [ecdsaSignerId(runtime.construction.eoa)]
              : [],
            threshold: 1,
          },
        }
  const signable = requests.filter(
    (request): request is Extract<IntentSigningRequest, { kind: 'eip712' }> =>
      request.kind === 'eip712',
  )
  const first = signable[0]
  if (!first) throw new Error('Intent quote has no EIP-712 signing requests')
  return {
    // Standalone `signIntent(requests)` builds a synthetic quote with no
    // intentId; fall back to the first payload hash so the signing-task
    // namespace stays deterministic rather than relying on `stringToHex`
    // coercing `undefined` to an empty string.
    id: quote.intentId
      ? keccak256(stringToHex(quote.intentId))
      : first.payload.id,
    preparedSignatureMode: sessions
      ? Object.values(sessions).some(({ verifyExecutions }) => verifyExecutions)
        ? 'session-with-execution-verification'
        : 'session'
      : 'default',
    ...topology,
    requests,
    artifacts: signable.map((request) => ({
      id: request.artifactId,
      usage: request.payload.usage,
      payloadId: request.payload.id,
      cardinality: 'one' as const,
      shape: request.shape,
      exposedForIndependentSigning: request.exposedForIndependentSigning,
    })),
  }
}

function requireSession(
  sessions: Readonly<Record<number, ResolvedSessionSignerSet>>,
): ResolvedSessionSignerSet {
  const session = Object.values(sessions)[0]
  if (!session) throw new Error('Intent session selection is empty')
  return session
}
