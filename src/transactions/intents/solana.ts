import { p256 } from '@noble/curves/nist'
import { base64urlnopad } from '@scure/base'
import {
  type Account,
  type Address,
  bytesToHex,
  concat,
  type Hex,
  hexToBytes,
  isAddress,
  isAddressEqual,
  recoverMessageAddress,
  sha256,
  stringToBytes,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import { formatCaip2 } from '../../chains/caip2'
import type {
  SolanaAddress,
  SolanaChain,
  SolanaInstruction,
} from '../../chains/non-evm'
import {
  solanaAddress,
  solanaDevnet,
  solanaMainnet,
} from '../../chains/non-evm'
import type {
  NormalizedIntentInput,
  NormalizedIntentOptions,
} from '../../clients/orchestrator/normalized'
import {
  isSponsoredIntentInput,
  projectCompatibleIntentInput,
} from '../../clients/orchestrator/normalized'
import type {
  IntentQuotePort,
  IntentSubmissionPort,
} from '../../clients/orchestrator/port'
import type {
  AppFeeRate,
  ProtocolFeeRate,
  SerializedIntentInput,
  SigningProof,
  SigningRequest,
  SwigAuthority,
  WebAuthnAssertion,
} from '../../clients/orchestrator/public'
import type {
  OrchestratorIntentRequest,
  OrchestratorQuote,
  OrchestratorSponsorship,
} from '../../clients/orchestrator/types'
import {
  InvalidSolanaTransactionArtifactError,
  SolanaQuoteExpiredError,
} from '../../errors/execution'
import { normalizeRecovery } from '../../signing/signers/ecdsa'
import { normalizeIntentQuote } from './normalize'
import {
  normalizeSolanaAddressLookupTables,
  normalizeSolanaInstructions,
} from './solana-instructions'

const SOLANA_MAINNET_ID = 792703809
const SOLANA_DEVNET_ID = 792703810
const SOLANA_MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
const SOLANA_DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const NATIVE_SOL_SENTINEL = '11111111111111111111111111111111'

/**
 * Where a Solana-origin spend lands. The two arms are exclusive on purpose:
 * every validation site has to state which direction it is checking, so a
 * same-chain rule cannot silently apply to a cross-chain quote.
 */
export type SolanaDelivery =
  | { readonly kind: 'same-chain'; readonly recipient: SolanaAddress }
  | {
      readonly kind: 'cross-chain'
      readonly chainId: number
      readonly token: Address
      readonly recipient: Address
    }

/**
 * What a Solana-origin intent does: move one SPL mint, or run caller-supplied
 * instructions out of the account's own wallet. The arms are exclusive — an
 * instruction execution is tokenless and names no recipient.
 */
export type SolanaAction =
  | {
      readonly kind: 'transfer'
      readonly mint: SolanaAddress
      readonly amount?: bigint
      readonly delivery: SolanaDelivery
    }
  | {
      readonly kind: 'instructions'
      readonly instructions: readonly SolanaInstruction[]
      readonly addressLookupTables?: readonly string[]
    }

export interface SolanaTransferInput {
  readonly chain: SolanaChain
  readonly action: SolanaAction
  readonly accountAddress: Address
  readonly accountType: 'GENERIC' | 'ERC7579' | 'EOA'
  readonly authority: SwigAuthority
  readonly walletAddress: SolanaAddress
  readonly swigAddress: SolanaAddress
  readonly namespace: 'dev-v1'
  readonly endpoint: string
  readonly appFees?: AppFeeRate
  readonly protocolFees?: ProtocolFeeRate
  readonly sponsorSettings?: NormalizedIntentOptions['sponsorSettings']
}

export interface PreparedSolanaIntent {
  readonly traceId: string
  readonly input: SolanaTransferInput
  readonly request: OrchestratorIntentRequest
  readonly normalized: NormalizedIntentInput
  readonly quote: OrchestratorQuote
  readonly quotes: readonly OrchestratorQuote[]
}

/** An ECDSA owner answers a spend with `personalSign`, a passkey with `webauthn`. */
export type SolanaSpendProof = Extract<
  SigningProof,
  { kind: 'personalSign' | 'webauthn' }
>

export interface SignedSolanaIntent {
  readonly prepared: PreparedSolanaIntent
  readonly proof: SolanaSpendProof
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

export interface BuiltSolanaIntentRequest {
  readonly request: OrchestratorIntentRequest
  readonly normalized: NormalizedIntentInput
}

function toSponsorship(
  settings: NormalizedIntentOptions['sponsorSettings'],
): OrchestratorSponsorship | undefined {
  return settings ? { ...settings } : undefined
}

export function buildSolanaIntentRequest(
  input: SolanaTransferInput,
): BuiltSolanaIntentRequest {
  const chainId = solanaChainId(input.chain)
  const caip2 = formatCaip2(chainId)
  if (input.namespace !== 'dev-v1') {
    throw new InvalidSolanaTransactionArtifactError(
      'the managed account namespace must be dev-v1',
    )
  }
  validateFee('appFees', input.appFees)
  validateFee('protocolFees', input.protocolFees)
  const normalizedAccount = {
    address: input.accountAddress,
    accountType: input.accountType,
  }
  const normalizedOptions: NormalizedIntentOptions = {
    signatureMode: 1,
    ...(input.appFees ? { appFees: input.appFees } : {}),
    ...(input.protocolFees ? { protocolFees: input.protocolFees } : {}),
    ...(input.sponsorSettings
      ? { sponsorSettings: input.sponsorSettings }
      : {}),
  }
  const sponsorship = toSponsorship(input.sponsorSettings)
  const options = {
    ...(input.appFees ? { appFees: input.appFees } : {}),
    ...(input.protocolFees ? { protocolFees: input.protocolFees } : {}),
    ...(sponsorship ? { sponsorship } : {}),
  }
  // The Swig is named explicitly, and its EVM identity travels with it: the
  // backend still binds a managed Solana wallet to the EVM account. No
  // `initData` — a missing Swig is a refusal, not a deployment request.
  const account = {
    evm: {
      type: (input.accountType === 'EOA' ? 'eoa' : 'erc7579') as
        | 'eoa'
        | 'erc7579',
      address: input.accountAddress,
      signatureMode: 1,
    },
    svm: {
      type: 'swig' as const,
      address: input.walletAddress,
      authorization: input.authority,
    },
  }

  if (input.action.kind === 'instructions') {
    if (input.appFees || input.protocolFees) {
      throw new InvalidSolanaTransactionArtifactError(
        'a Solana instruction execution carries no value leg to charge fees on',
      )
    }
    const lookupTables = normalizeSolanaAddressLookupTables(
      input.action.addressLookupTables,
    )
    const instructions = normalizeSolanaInstructions(input.action.instructions)
    return {
      request: {
        account,
        destination: {
          vm: 'svm',
          chainId: caip2,
          // Tokenless: the instructions move whatever they move, and the payee
          // is encoded inside them, so this names neither token nor recipient
          // and acquires no funding mint.
          tokenRequests: [],
          execution: {
            instructions,
            ...(lookupTables ? { addressLookupTables: lookupTables } : {}),
          },
        },
        source: {
          selection: { chains: { only: [caip2] }, tokens: 'all' },
        },
        ...(Object.keys(options).length > 0 ? { options } : {}),
      },
      normalized: {
        destinationExecutions: [],
        account: normalizedAccount,
        options: normalizedOptions,
        destinationChainId: chainId,
        tokenRequests: [],
        destinationInstructions:
          instructions as NormalizedIntentInput['destinationInstructions'],
        ...(lookupTables ? { addressLookupTableAddresses: lookupTables } : {}),
        accountAccessList: { chainIds: [chainId] },
      },
    }
  }

  const mint = solanaAddress(input.action.mint)
  if (mint === NATIVE_SOL_SENTINEL) {
    throw new InvalidSolanaTransactionArtifactError(
      'native SOL transfers are not supported; provide an SPL mint',
    )
  }
  if (
    input.action.amount !== undefined &&
    (typeof input.action.amount !== 'bigint' || input.action.amount <= 0n)
  ) {
    throw new InvalidSolanaTransactionArtifactError(
      'the token amount must be a positive bigint when provided',
    )
  }
  const amount =
    input.action.amount === undefined
      ? {}
      : ({ amount: input.action.amount } as const)
  const delivery = input.action.delivery

  if (delivery.kind === 'cross-chain') {
    if (
      !Number.isSafeInteger(delivery.chainId) ||
      delivery.chainId < 0 ||
      !formatCaip2(delivery.chainId).startsWith('eip155:')
    ) {
      throw new InvalidSolanaTransactionArtifactError(
        'the delivery chain must be an EVM chain',
      )
    }
    if (!isAddress(delivery.token) || !isAddress(delivery.recipient)) {
      throw new InvalidSolanaTransactionArtifactError(
        'the delivery token and recipient must be EVM addresses',
      )
    }
    return {
      request: {
        account,
        destination: {
          vm: 'evm',
          chainId: formatCaip2(delivery.chainId),
          recipient: { address: delivery.recipient },
          tokenRequests: [{ tokenAddress: delivery.token, ...amount }],
        },
        // Pinned to the cluster and the one mint: naming the cluster without
        // the mint would re-expand the source scope to every registry token
        // on it and defeat the explicit source asset.
        source: {
          selection: {
            chains: { only: [caip2] },
            tokens: { only: [mint] },
            perChain: { [caip2]: { tokens: { only: [mint] } } },
          },
        },
        ...(Object.keys(options).length > 0 ? { options } : {}),
      },
      normalized: {
        destinationExecutions: [],
        account: normalizedAccount,
        options: normalizedOptions,
        destinationChainId: delivery.chainId,
        tokenRequests: [{ tokenAddress: delivery.token, ...amount }],
        recipient: { address: delivery.recipient },
        accountAccessList: { chainTokens: { [chainId]: [mint] } },
      },
    }
  }

  const recipient = solanaAddress(delivery.recipient)
  if (recipient === input.walletAddress) {
    throw new InvalidSolanaTransactionArtifactError(
      'the recipient must differ from the managed Solana wallet',
    )
  }
  return {
    request: {
      account,
      destination: {
        vm: 'svm',
        chainId: caip2,
        recipient: { address: recipient },
        tokenRequests: [{ tokenAddress: mint, ...amount }],
      },
      source: {
        selection: {
          chains: { only: [caip2] },
          tokens: { only: [mint] },
          perChain: { [caip2]: { tokens: { only: [mint] } } },
        },
      },
      ...(Object.keys(options).length > 0 ? { options } : {}),
    },
    normalized: {
      destinationExecutions: [],
      account: normalizedAccount,
      options: normalizedOptions,
      destinationChainId: chainId,
      tokenRequests: [{ tokenAddress: mint, ...amount }],
      recipient: { address: recipient },
      accountAccessList: { chainIds: [chainId] },
    },
  }
}

function deliveryKind(input: SolanaTransferInput): SolanaDelivery['kind'] {
  return input.action.kind === 'instructions'
    ? 'same-chain'
    : input.action.delivery.kind
}

type SolanaSpendPayload = {
  readonly request: SigningRequest
  readonly expiresAtSlot: string
} & (
  | {
      readonly kind: 'personalSign'
      /** The exact characters to sign. Opaque to the SDK, despite looking like hex. */
      readonly message: string
    }
  | { readonly kind: 'webauthn'; readonly challenge: Hex }
)

function spendPayload(
  quote: OrchestratorQuote,
  input: SolanaTransferInput,
  delivery: SolanaDelivery['kind'],
): SolanaSpendPayload {
  const request = quote.signingRequests[0]
  // Not a `=== 'RELAY'` whitelist: the same corridor is planned on other
  // settlement layers, and any of them authorizes the spend identically.
  const layerMismatch =
    delivery === 'same-chain'
      ? quote.settlementLayer !== 'SAME_CHAIN'
      : quote.settlementLayer === 'SAME_CHAIN'
  const refuse = (reason: string): never => {
    throw new InvalidSolanaTransactionArtifactError(reason, {
      intentId: quote.intentId,
    })
  }
  if (!quote.intentId) {
    refuse('the quote must carry an intent id')
  }
  if (layerMismatch) {
    refuse(
      delivery === 'same-chain'
        ? 'the quote must be a SAME_CHAIN route'
        : 'the quote must be a cross-chain route',
    )
  }
  if (quote.signingRequests.length !== 1 || !request) {
    refuse('the quote must carry exactly one signing request')
  }
  const expected = input.authority
  let signed:
    | { readonly kind: 'personalSign'; readonly message: string }
    | { readonly kind: 'webauthn'; readonly challenge: Hex }
  if (expected.kind === 'secp256r1') {
    if (request!.payload.kind !== 'webauthn') {
      refuse('the quote must ask for a WebAuthn spend authorization')
    }
    const { challenge } = request!.payload as Extract<
      SigningRequest['payload'],
      { kind: 'webauthn' }
    >
    if (!/^0x[0-9a-fA-F]{64}$/u.test(challenge)) {
      refuse('the WebAuthn challenge must be 32 bytes of hex')
    }
    signed = { kind: 'webauthn', challenge: challenge as Hex }
  } else {
    if (
      request!.payload.kind !== 'personalSign' ||
      request!.payload.message.encoding !== 'utf8'
    ) {
      refuse('the quote must ask for a UTF-8 personal-sign spend authorization')
    }
    const payload = request!.payload as Extract<
      SigningRequest['payload'],
      { kind: 'personalSign' }
    >
    if (!/^[0-9a-fA-F]{64}$/u.test(payload.message.value)) {
      refuse('the personal-sign message must be a 64-character opaque payload')
    }
    signed = { kind: 'personalSign', message: payload.message.value }
  }
  // The Swig wallet holds the assets; the state account is a different address
  // and signing for it would authorize nothing.
  if (
    request!.account.vm !== 'svm' ||
    request!.account.wallet !== input.walletAddress ||
    request!.account.swigAccount !== input.swigAddress
  ) {
    refuse(
      'the signing request must name the configured Swig wallet and state account',
    )
  }
  const authority = request!.authority
  const role = authority.kind === 'swigRole' ? authority.authority : authority
  const named =
    expected.kind === 'secp256r1'
      ? role.kind === 'secp256r1' &&
        role.publicKey.toLowerCase() === expected.publicKey.toLowerCase()
      : role.kind === 'secp256k1' &&
        role.address.toLowerCase() === expected.address.toLowerCase()
  if (!named) {
    refuse('the signing request must name the configured Solana authority')
  }
  const scope = request!.scope
  if (scope.vm !== 'svm' || scope.action !== 'spend') {
    refuse('the signing request must authorize a Solana spend')
  }
  const slot = request!.validity.find(
    (entry): entry is Extract<typeof entry, { kind: 'svmSlot' }> =>
      entry.kind === 'svmSlot',
  )
  if (!slot || !/^\d+$/u.test(slot.expiresAtSlot)) {
    refuse('the signing request must disclose a decimal Solana slot window')
  }
  return {
    request: request!,
    expiresAtSlot: slot!.expiresAtSlot,
    ...signed,
  }
}

function validateQuote(quote: OrchestratorQuote, input: SolanaTransferInput) {
  spendPayload(quote, input, deliveryKind(input))
  const chainId = formatCaip2(solanaChainId(input.chain))
  if (input.action.kind === 'instructions') {
    // The serving route decides how many cost legs an instruction execution
    // has, so only their chain is asserted: anything off the requested cluster
    // is not this intent.
    const offChain = [...quote.cost.input, ...quote.cost.output].some(
      (leg) => leg.chainId !== chainId,
    )
    if (offChain) {
      throw new InvalidSolanaTransactionArtifactError(
        'every quote cost must reference the requested Solana chain',
        { intentId: quote.intentId },
      )
    }
    return
  }
  if (quote.cost.input.length !== 1 || quote.cost.output.length !== 1) {
    throw new InvalidSolanaTransactionArtifactError(
      'quote costs must include exactly one input and one output entry',
      { intentId: quote.intentId },
    )
  }
  const source = quote.cost.input[0]!
  if (source.chainId !== chainId || source.tokenAddress !== input.action.mint) {
    throw new InvalidSolanaTransactionArtifactError(
      'the quote input cost must reference the requested Solana chain and mint',
      { intentId: quote.intentId },
    )
  }
  const output = quote.cost.output[0]!
  const delivery = input.action.delivery
  if (delivery.kind === 'same-chain') {
    if (
      output.chainId !== chainId ||
      output.tokenAddress !== input.action.mint
    ) {
      throw new InvalidSolanaTransactionArtifactError(
        'the quote output cost must reference the requested Solana chain and mint',
        { intentId: quote.intentId },
      )
    }
    return
  }
  // The orchestrator lowercases EVM addresses; base58 mints stay exact.
  if (
    output.chainId !== formatCaip2(delivery.chainId) ||
    typeof output.tokenAddress !== 'string' ||
    output.tokenAddress.toLowerCase() !== delivery.token.toLowerCase()
  ) {
    throw new InvalidSolanaTransactionArtifactError(
      'the quote output cost must reference the requested delivery chain and token',
      { intentId: quote.intentId },
    )
  }
}

export async function prepareSolanaIntent(
  context: SolanaWorkflowContext,
  input: SolanaTransferInput,
): Promise<PreparedSolanaIntent> {
  const { request, normalized } = buildSolanaIntentRequest(input)
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
    normalized,
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
  const { request, normalized } = buildSolanaIntentRequest(input.transfer)
  if (
    stable(projectCompatibleIntentInput(normalized)) !==
    stable(input.intentInput)
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
    normalized,
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
  readonly owner: Account | WebAuthnAccount
  readonly now: () => number
}): Promise<SignedSolanaIntent> {
  assertSolanaNotExpired(input.now(), input.prepared.quote)
  const payload = spendPayload(
    input.prepared.quote,
    input.prepared.input,
    deliveryKind(input.prepared.input),
  )
  const refuse = (reason: string): never => {
    throw new InvalidSolanaTransactionArtifactError(reason, {
      intentId: input.prepared.quote.intentId,
    })
  }
  const authority = input.prepared.input.authority
  if (authority.kind === 'secp256r1') {
    if (input.owner.type !== 'webAuthn') {
      refuse(
        'the configured authority is a passkey; provide the viem WebAuthn account that owns it',
      )
    }
    const owner = input.owner as WebAuthnAccount
    const { challenge } = payload as Extract<
      SolanaSpendPayload,
      { kind: 'webauthn' }
    >
    const { signature, webauthn } = await owner.sign({ hash: challenge })
    const assertion: WebAuthnAssertion = {
      credentialId: owner.id,
      authenticatorData: webauthn.authenticatorData,
      // Passed through untouched: the orchestrator hashes these exact bytes.
      clientDataJSON: webauthn.clientDataJSON,
      signature,
    }
    validateSolanaWebAuthnAssertion(
      authority.publicKey,
      { challenge },
      assertion,
    )
    return { prepared: input.prepared, proof: { kind: 'webauthn', assertion } }
  }
  const owner = input.owner as Account
  if (input.owner.type === 'webAuthn' || !owner.signMessage) {
    refuse(
      'the configured authority cannot sign messages; provide a viem account with signMessage for headless signing',
    )
  }
  const { message } = payload as Extract<
    SolanaSpendPayload,
    { kind: 'personalSign' }
  >
  const signature = normalizeRecovery(await owner.signMessage!({ message }))
  await validateSolanaSignature(authority.address, { message }, signature)
  return {
    prepared: input.prepared,
    proof: { kind: 'personalSign', signature },
  }
}

export async function validateSolanaSignature(
  authority: Address,
  payload: { readonly message: string },
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

/**
 * Checks a passkey assertion the way the orchestrator will: the client data is
 * a `webauthn.get` over this challenge, and the P-256 signature verifies over
 * `authenticatorData ‖ sha256(clientDataJSON)` under the configured key.
 */
export function validateSolanaWebAuthnAssertion(
  publicKey: Hex,
  payload: { readonly challenge: Hex },
  assertion: WebAuthnAssertion,
): void {
  const refuse = (reason: string): never => {
    throw new InvalidSolanaTransactionArtifactError(reason)
  }
  if (
    typeof assertion.credentialId !== 'string' ||
    assertion.credentialId.length === 0
  ) {
    refuse('the passkey assertion must name its credential')
  }
  if (!/^0x(?:[0-9a-fA-F]{2}){37,}$/u.test(assertion.authenticatorData)) {
    refuse('the passkey authenticator data must be at least 37 bytes of hex')
  }
  if (!/^0x[0-9a-fA-F]{128}$/u.test(assertion.signature)) {
    refuse('the passkey signature must be a 64-byte r‖s P-256 signature')
  }
  let clientData: { type?: unknown; challenge?: unknown } | undefined
  try {
    clientData = /^\{[\s\S]*\}$/u.test(assertion.clientDataJSON)
      ? JSON.parse(assertion.clientDataJSON)
      : undefined
  } catch {
    clientData = undefined
  }
  if (clientData?.type !== 'webauthn.get') {
    refuse('the passkey client data must be a webauthn.get assertion')
  }
  if (
    clientData!.challenge !==
    base64urlnopad.encode(hexToBytes(payload.challenge))
  ) {
    refuse('the passkey assertion does not sign the requested challenge')
  }
  const digest = sha256(
    concat([
      assertion.authenticatorData,
      sha256(stringToBytes(assertion.clientDataJSON)),
    ]),
    'bytes',
  )
  let verified = false
  try {
    verified = p256.verify(
      hexToBytes(assertion.signature),
      digest,
      hexToBytes(publicKey),
      { format: 'compact' },
    )
  } catch {
    verified = false
  }
  if (!verified) {
    refuse(
      'the passkey signature does not verify under the configured Solana authority',
    )
  }
}

/**
 * SEC1-compresses a P-256 public key: the 64-byte x‖y a viem WebAuthn
 * credential carries, or a 65-byte uncompressed or 33-byte compressed SEC1 key.
 * Throws when the key is not a point on the curve.
 */
export function compressP256PublicKey(publicKey: Hex): Hex {
  const bytes = hexToBytes(publicKey)
  const sec1 =
    bytes.length === 64 ? concat([new Uint8Array([4]), bytes]) : bytes
  return bytesToHex(p256.ProjectivePoint.fromHex(sec1).toRawBytes(true))
}

export async function submitSolanaIntent(
  context: SolanaWorkflowContext,
  signed: SignedSolanaIntent,
) {
  assertSolanaNotExpired(context.now(), signed.prepared.quote)
  const action = signed.prepared.input.action
  const payload = spendPayload(
    signed.prepared.quote,
    signed.prepared.input,
    deliveryKind(signed.prepared.input),
  )
  const authority = signed.prepared.input.authority
  const proof = signed.proof
  if (authority.kind === 'secp256r1' && proof.kind === 'webauthn') {
    validateSolanaWebAuthnAssertion(
      authority.publicKey,
      payload as Extract<SolanaSpendPayload, { kind: 'webauthn' }>,
      proof.assertion,
    )
  } else if (authority.kind === 'secp256k1' && proof.kind === 'personalSign') {
    await validateSolanaSignature(
      authority.address,
      payload as Extract<SolanaSpendPayload, { kind: 'personalSign' }>,
      proof.signature,
    )
  } else {
    throw new InvalidSolanaTransactionArtifactError(
      'the spend proof does not match the configured Solana authority',
      { intentId: signed.prepared.quote.intentId },
    )
  }
  const response = await context.submissionClient.submitIntent(
    {
      intentId: signed.prepared.quote.intentId,
      proofs: [proof],
    },
    {
      intentInput: projectCompatibleIntentInput(signed.prepared.normalized),
      sponsored: isSponsoredIntentInput(signed.prepared.normalized),
    },
  )
  return {
    type: 'intent' as const,
    traceId: response.traceId,
    intentId: response.intentId,
    sourceChains: [solanaChainId(signed.prepared.input.chain)],
    targetChain:
      action.kind === 'transfer' && action.delivery.kind === 'cross-chain'
        ? action.delivery.chainId
        : solanaChainId(signed.prepared.input.chain),
  }
}
