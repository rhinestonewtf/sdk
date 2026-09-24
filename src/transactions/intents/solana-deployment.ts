import { type Hex, hexToBytes, isHex } from 'viem'
import {
  isManagedSwigNamespace,
  locateSwigById,
  type ManagedSwigNamespace,
} from '../../accounts/solana/address'
import { formatCaip2 } from '../../chains/caip2'
import type { SolanaAddress, SolanaChain } from '../../chains/non-evm'
import type { NormalizedIntentInput } from '../../clients/orchestrator/normalized'
import { projectCompatibleIntentInput } from '../../clients/orchestrator/normalized'
import type { SwigAuthority } from '../../clients/orchestrator/public'
import type {
  OrchestratorDeploymentQuote,
  OrchestratorIntentRequest,
  OrchestratorQuote,
  OrchestratorSwigInitData,
} from '../../clients/orchestrator/types'
import { InvalidSolanaTransactionArtifactError } from '../../errors/execution'
import {
  assertSolanaNotExpired,
  type SolanaWorkflowContext,
  solanaChainId,
} from './solana'
import type { SubmittedIntent } from './types'

/** What a Swig creation installs, and where. */
export interface SolanaDeploymentInput {
  readonly chain: SolanaChain
  readonly walletAddress: SolanaAddress
  readonly swigAddress: SolanaAddress
  /** The configured owner, as a spend names it. */
  readonly authorization: SwigAuthority
  /** The same owner as the public key installed as the permanent root role. */
  readonly initAuthority: OrchestratorSwigInitData['authority']
  /** The 32-byte id that derives `swigAddress`. */
  readonly swigId: Hex
  readonly namespace: ManagedSwigNamespace
  readonly endpoint: string
}

export interface PreparedSolanaDeployment {
  readonly traceId: string
  readonly input: SolanaDeploymentInput
  readonly request: OrchestratorIntentRequest
  readonly normalized: NormalizedIntentInput
  readonly quote: OrchestratorDeploymentQuote
}

function refuse(reason: string, intentId?: string): never {
  throw new InvalidSolanaTransactionArtifactError(
    reason,
    intentId === undefined ? undefined : { intentId },
  )
}

function assertInitAuthority(input: SolanaDeploymentInput): void {
  const { authorization, initAuthority } = input
  if (authorization.kind !== initAuthority.kind) {
    refuse('the installed authority must be the configured Solana owner')
  }
  if (
    initAuthority.kind === 'secp256r1' &&
    (authorization.kind !== 'secp256r1' ||
      !/^0x0[23][0-9a-fA-F]{64}$/u.test(initAuthority.publicKey) ||
      initAuthority.publicKey.toLowerCase() !==
        authorization.publicKey.toLowerCase())
  ) {
    refuse(
      'the installed passkey must be the configured 33-byte compressed P-256 key',
    )
  }
  if (
    initAuthority.kind === 'secp256k1' &&
    !/^0x(?:0[23][0-9a-fA-F]{64}|04[0-9a-fA-F]{128})$/u.test(
      initAuthority.publicKey,
    )
  ) {
    refuse('the installed ECDSA authority must be a SEC1 secp256k1 public key')
  }
}

export function buildSolanaDeploymentRequest(input: SolanaDeploymentInput): {
  readonly request: OrchestratorIntentRequest
  readonly normalized: NormalizedIntentInput
} {
  const chainId = solanaChainId(input.chain)
  const caip2 = formatCaip2(chainId)
  if (!isManagedSwigNamespace(input.namespace)) {
    refuse('the managed account namespace must be dev-v1 or prod-v1')
  }
  if (!isHex(input.swigId) || hexToBytes(input.swigId).length !== 32) {
    refuse('the Swig id must be 32 bytes of hex')
  }
  const location = locateSwigById(hexToBytes(input.swigId))
  if (
    location.swig !== input.swigAddress ||
    location.wallet !== input.walletAddress
  ) {
    refuse('the Swig id does not derive the configured Swig and wallet')
  }
  assertInitAuthority(input)
  return {
    request: {
      // The Solana-only shape: no `evm` entry, so the id is sent explicitly,
      // even for the Swig the managed EVM account derives.
      account: {
        svm: {
          type: 'swig',
          address: input.walletAddress,
          swigAccount: input.swigAddress,
          authorization: input.authorization,
          initData: {
            authority: input.initAuthority,
            id: input.swigId.toLowerCase() as Hex,
          },
        },
      },
      // No recipient, execution or token: that is what makes this a creation.
      destination: { vm: 'svm', chainId: caip2, tokenRequests: [] },
      source: { selection: { chains: { only: [caip2] }, tokens: 'all' } },
      // Gas only: Solana routes refuse the other sponsorship categories.
      options: { sponsorship: { gas: true } },
    },
    normalized: {
      account: { address: input.walletAddress },
      destinationChainId: chainId,
      destinationExecutions: [],
      tokenRequests: [],
      accountAccessList: { chainIds: [chainId] },
      options: {
        signatureMode: 1,
        sponsorSettings: { gas: true, bridgeFees: false, swapFees: false },
      },
    },
  }
}

function sameAuthority(
  actual: SwigAuthority | undefined,
  expected: SwigAuthority,
): boolean {
  if (!actual) return false
  return expected.kind === 'secp256r1'
    ? actual.kind === 'secp256r1' &&
        actual.publicKey.toLowerCase() === expected.publicKey.toLowerCase()
    : actual.kind === 'secp256k1' &&
        actual.address.toLowerCase() === expected.address.toLowerCase()
}

/**
 * Checks a route creates exactly the configured Swig, with the configured
 * owner as its root, on the requested cluster — and asks for nothing else.
 * Creation is permanent, so anything unexpected is refused before submission.
 */
function validateDeploymentQuote(
  quote: OrchestratorQuote,
  input: SolanaDeploymentInput,
): OrchestratorDeploymentQuote {
  if (!quote.intentId) {
    refuse('the quote must carry an intent id')
  }
  const reject = (reason: string): never => refuse(reason, quote.intentId)
  if (quote.purpose !== 'deployment') {
    return reject('the quote must be a deployment route')
  }
  if (quote.signingRequests.length > 0) {
    reject('a deployment route must ask for no signatures')
  }
  if (quote.requirements.length > 0) {
    reject('a deployment route must have no requirements')
  }
  const chainId = formatCaip2(solanaChainId(input.chain))
  const deployments = quote.plan.deployments
  const deployment = deployments[0]
  const account = deployment?.account
  if (
    deployments.length !== 1 ||
    !deployment ||
    deployment.vm !== 'svm' ||
    deployment.chainId !== chainId ||
    !account ||
    !('swigAccount' in account) ||
    account.swigAccount !== input.swigAddress ||
    account.wallet !== input.walletAddress
  ) {
    reject(
      'the deployment must create exactly the configured Swig and wallet on the requested Solana chain',
    )
  }
  if (
    !sameAuthority(
      (account as { authority?: SwigAuthority }).authority,
      input.authorization,
    )
  ) {
    reject('the deployment must install the configured Solana owner')
  }
  if (quote.deploymentCosts.some((cost) => cost.chainId !== chainId)) {
    reject('every deployment cost must reference the requested Solana chain')
  }
  return quote
}

export async function prepareSolanaDeployment(
  context: SolanaWorkflowContext,
  input: SolanaDeploymentInput,
): Promise<PreparedSolanaDeployment> {
  const { request, normalized } = buildSolanaDeploymentRequest(input)
  const response = await context.quoteClient.createQuote(request)
  if (response.routes.length === 0) {
    refuse('the orchestrator returned no quote')
  }
  const quotes = response.routes.map((route) =>
    validateDeploymentQuote(route, input),
  )
  const quote = quotes[0]!
  assertSolanaNotExpired(context.now(), quote)
  return { traceId: response.traceId, input, request, normalized, quote }
}

export async function submitSolanaDeployment(
  context: SolanaWorkflowContext,
  prepared: PreparedSolanaDeployment,
): Promise<SubmittedIntent> {
  assertSolanaNotExpired(context.now(), prepared.quote)
  const response = await context.submissionClient.submitIntent(
    { intentId: prepared.quote.intentId, proofs: [] },
    {
      intentInput: projectCompatibleIntentInput(prepared.normalized),
      sponsored: true,
    },
  )
  const chainId = solanaChainId(prepared.input.chain)
  return {
    type: 'intent',
    traceId: response.traceId,
    intentId: response.intentId,
    sourceChains: [chainId],
    targetChain: chainId,
  }
}
