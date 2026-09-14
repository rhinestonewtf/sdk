import {
  type Account,
  type Address,
  type Hex,
  hexToBytes,
  isAddressEqual,
  recoverMessageAddress,
} from 'viem'
import type { SolanaAddress, SolanaChain } from '../../chains/non-evm'
import {
  solanaAddress,
  solanaDevnet,
  solanaMainnet,
} from '../../chains/non-evm'
import type {
  IntentQuotePort,
  IntentSubmissionPort,
} from '../../clients/orchestrator/port'
import type {
  AppFeeRate,
  PersonalSignOriginSignData,
  ProtocolFeeRate,
  SerializedIntentInput,
} from '../../clients/orchestrator/public'
import type {
  OrchestratorIntentRequest,
  OrchestratorQuote,
} from '../../clients/orchestrator/types'
import {
  InvalidSolanaTransactionArtifactError,
  SolanaQuoteExpiredError,
} from '../../errors/execution'
import { normalizeRecovery } from '../../signing/signers/ecdsa'
import { projectCompatibleIntentInput } from './compatibility'
import { normalizeIntentQuote } from './normalize'

const SOLANA_MAINNET_ID = 792703809
const SOLANA_DEVNET_ID = 792703810
const SOLANA_MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
const SOLANA_DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const NATIVE_SOL_SENTINEL = '11111111111111111111111111111111'

export interface SolanaTransferInput {
  readonly chain: SolanaChain
  readonly mint: SolanaAddress
  readonly amount?: bigint
  readonly recipient: SolanaAddress
  readonly accountAddress: Address
  readonly accountType: 'GENERIC' | 'ERC7579' | 'EOA'
  readonly authority: Address
  readonly walletAddress: SolanaAddress
  readonly swigAddress: SolanaAddress
  readonly namespace: 'dev-v1'
  readonly endpoint: string
  readonly appFees?: AppFeeRate
  readonly protocolFees?: ProtocolFeeRate
}

export interface PreparedSolanaIntent {
  readonly traceId: string
  readonly input: SolanaTransferInput
  readonly request: OrchestratorIntentRequest
  readonly quote: OrchestratorQuote
  readonly quotes: readonly OrchestratorQuote[]
}

export interface SignedSolanaIntent {
  readonly prepared: PreparedSolanaIntent
  readonly signature: Hex
}

export interface SolanaWorkflowContext {
  readonly quoteClient: IntentQuotePort
  readonly submissionClient: IntentSubmissionPort
  readonly now: () => number
}

export function solanaChainId(chain: SolanaChain): number {
  const expected =
    chain.caip2 === SOLANA_MAINNET_CAIP2
      ? solanaMainnet
      : chain.caip2 === SOLANA_DEVNET_CAIP2
        ? solanaDevnet
        : undefined
  if (
    !expected ||
    chain.kind !== expected.kind ||
    chain.name !== expected.name ||
    chain.testnet !== (expected as SolanaChain).testnet ||
    chain.nativeCurrency.name !== expected.nativeCurrency.name ||
    chain.nativeCurrency.symbol !== expected.nativeCurrency.symbol ||
    chain.nativeCurrency.decimals !== expected.nativeCurrency.decimals
  ) {
    throw new InvalidSolanaTransactionArtifactError(
      'the chain must be the canonical Solana mainnet or devnet descriptor',
    )
  }
  return chain.caip2 === SOLANA_MAINNET_CAIP2
    ? SOLANA_MAINNET_ID
    : SOLANA_DEVNET_ID
}

function validateFee(
  name: string,
  fee: AppFeeRate | ProtocolFeeRate | undefined,
) {
  if (!fee) return
  if (
    typeof fee !== 'object' ||
    typeof fee.feeBps !== 'number' ||
    !Number.isInteger(fee.feeBps) ||
    fee.feeBps < 0 ||
    fee.feeBps > 10_000
  ) {
    throw new InvalidSolanaTransactionArtifactError(
      `${name}.feeBps must be an integer from 0 to 10000`,
    )
  }
}

export function buildSolanaIntentRequest(
  input: SolanaTransferInput,
): OrchestratorIntentRequest {
  const chainId = solanaChainId(input.chain)
  if (input.namespace !== 'dev-v1') {
    throw new InvalidSolanaTransactionArtifactError(
      'the managed account namespace must be dev-v1',
    )
  }
  const mint = solanaAddress(input.mint)
  const recipient = solanaAddress(input.recipient)
  if (mint === NATIVE_SOL_SENTINEL) {
    throw new InvalidSolanaTransactionArtifactError(
      'native SOL transfers are not supported; provide an SPL mint',
    )
  }
  if (recipient === input.walletAddress) {
    throw new InvalidSolanaTransactionArtifactError(
      'the recipient must differ from the managed Solana wallet',
    )
  }
  if (
    input.amount !== undefined &&
    (typeof input.amount !== 'bigint' || input.amount <= 0n)
  ) {
    throw new InvalidSolanaTransactionArtifactError(
      'the token amount must be a positive bigint when provided',
    )
  }
  validateFee('appFees', input.appFees)
  validateFee('protocolFees', input.protocolFees)
  return {
    destinationChainId: chainId,
    destinationExecutions: [],
    tokenRequests: [
      {
        tokenAddress: mint,
        ...(input.amount === undefined ? {} : { amount: input.amount }),
      },
    ],
    account: { address: input.accountAddress, accountType: input.accountType },
    recipient: { address: recipient },
    accountAccessList: { chainIds: [chainId] },
    options: {
      signatureMode: 1,
      ...(input.appFees ? { appFees: input.appFees } : {}),
      ...(input.protocolFees ? { protocolFees: input.protocolFees } : {}),
    },
  }
}

function personalPayload(quote: OrchestratorQuote): PersonalSignOriginSignData {
  const origin = quote.signData.origin[0]
  if (
    !quote.intentId ||
    quote.settlementLayer !== 'SAME_CHAIN' ||
    quote.signData.origin.length !== 1 ||
    origin?.kind !== 'personalSign' ||
    !/^[0-9a-fA-F]{64}$/u.test(origin.message) ||
    !/^\d+$/u.test(origin.expiresAtSlot) ||
    quote.signData.destination !== undefined ||
    quote.signData.targetExecution !== undefined
  ) {
    throw new InvalidSolanaTransactionArtifactError(
      'the quote must be SAME_CHAIN with exactly one personal-sign origin and no destination or target signature',
      { intentId: quote.intentId },
    )
  }
  return origin
}

function validateQuote(quote: OrchestratorQuote, input: SolanaTransferInput) {
  personalPayload(quote)
  const chainId = solanaChainId(input.chain)
  if (quote.cost.input.length !== 1 || quote.cost.output.length !== 1) {
    throw new InvalidSolanaTransactionArtifactError(
      'quote costs must include exactly one Solana input and output entry',
      { intentId: quote.intentId },
    )
  }
  for (const entry of [...quote.cost.input, ...quote.cost.output]) {
    if (entry.chainId !== chainId || entry.tokenAddress !== input.mint) {
      throw new InvalidSolanaTransactionArtifactError(
        'quote costs must reference only the requested Solana chain and mint',
        { intentId: quote.intentId },
      )
    }
  }
}

export async function prepareSolanaIntent(
  context: SolanaWorkflowContext,
  input: SolanaTransferInput,
): Promise<PreparedSolanaIntent> {
  const request = buildSolanaIntentRequest(input)
  const response = await context.quoteClient.createQuote(request)
  if (response.routes.length === 0) {
    throw new InvalidSolanaTransactionArtifactError(
      'the orchestrator returned no quote',
    )
  }
  const quotes = response.routes.map(normalizeIntentQuote)
  for (const quote of quotes) validateQuote(quote, input)
  return {
    traceId: response.traceId,
    input,
    request,
    quote: quotes[0]!,
    quotes,
  }
}

function canonical(value: unknown): unknown {
  if (typeof value === 'bigint') return { $bigint: value.toString() }
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    )
  }
  return value
}

function stable(value: unknown): string {
  return JSON.stringify(canonical(value))
}

export function reconstructSolanaIntent(input: {
  readonly traceId: string
  readonly transfer: SolanaTransferInput
  readonly intentInput: SerializedIntentInput
  readonly quote: OrchestratorQuote
  readonly quotes: readonly OrchestratorQuote[]
}): PreparedSolanaIntent {
  const request = buildSolanaIntentRequest(input.transfer)
  if (
    stable(projectCompatibleIntentInput(request)) !== stable(input.intentInput)
  ) {
    throw new InvalidSolanaTransactionArtifactError(
      'the canonical intent input does not match the captured transaction',
      { intentId: input.quote.intentId },
    )
  }
  const quotes = input.quotes.map(normalizeIntentQuote)
  const quote = quotes.find(({ intentId }) => intentId === input.quote.intentId)
  if (!quote || stable(quote) !== stable(normalizeIntentQuote(input.quote))) {
    throw new InvalidSolanaTransactionArtifactError(
      'the selected quote is missing or differs from the prepared quote set',
      { intentId: input.quote.intentId },
    )
  }
  for (const candidate of quotes) validateQuote(candidate, input.transfer)
  return {
    traceId: input.traceId,
    input: input.transfer,
    request,
    quote,
    quotes,
  }
}

export function assertSolanaNotExpired(
  now: number,
  quote: OrchestratorQuote,
): void {
  if (!Number.isFinite(quote.expiresAt) || now >= quote.expiresAt * 1000) {
    throw new SolanaQuoteExpiredError(quote.intentId)
  }
}

export async function signSolanaIntent(input: {
  readonly prepared: PreparedSolanaIntent
  readonly owner: Account
  readonly now: () => number
}): Promise<SignedSolanaIntent> {
  assertSolanaNotExpired(input.now(), input.prepared.quote)
  const payload = personalPayload(input.prepared.quote)
  if (!input.owner.signMessage) {
    throw new InvalidSolanaTransactionArtifactError(
      'the configured authority cannot sign messages; provide a viem account with signMessage for headless signing',
      { intentId: input.prepared.quote.intentId },
    )
  }
  const signature = normalizeRecovery(
    await input.owner.signMessage({ message: payload.message }),
  )
  await validateSolanaSignature(
    input.prepared.input.authority,
    payload,
    signature,
  )
  return { prepared: input.prepared, signature }
}

export async function validateSolanaSignature(
  authority: Address,
  payload: PersonalSignOriginSignData,
  signature: Hex,
): Promise<void> {
  let signatureLength: number
  try {
    signatureLength = hexToBytes(signature).length
  } catch {
    signatureLength = -1
  }
  if (signatureLength !== 65) {
    throw new InvalidSolanaTransactionArtifactError(
      'the origin signature must be a recoverable 65-byte ECDSA signature',
    )
  }
  let recovered: Address
  try {
    recovered = await recoverMessageAddress({
      message: payload.message,
      signature,
    })
  } catch {
    throw new InvalidSolanaTransactionArtifactError(
      'the origin signature is not recoverable',
    )
  }
  if (!isAddressEqual(recovered, authority)) {
    throw new InvalidSolanaTransactionArtifactError(
      'the origin signature does not recover to the configured Solana authority',
    )
  }
}

export async function submitSolanaIntent(
  context: SolanaWorkflowContext,
  signed: SignedSolanaIntent,
) {
  assertSolanaNotExpired(context.now(), signed.prepared.quote)
  const payload = personalPayload(signed.prepared.quote)
  await validateSolanaSignature(
    signed.prepared.input.authority,
    payload,
    signed.signature,
  )
  const response = await context.submissionClient.submitIntent(
    {
      intentId: signed.prepared.quote.intentId,
      signatures: { origin: [signed.signature] },
    },
    {
      intentInput: projectCompatibleIntentInput(signed.prepared.request),
      sponsored: false,
    },
  )
  return {
    type: 'intent' as const,
    traceId: response.traceId,
    intentId: response.intentId,
    sourceChains: [solanaChainId(signed.prepared.input.chain)],
    targetChain: solanaChainId(signed.prepared.input.chain),
  }
}
