import type {
  Address,
  Chain,
  HashTypedDataParameters,
  Hex,
  SignableMessage,
  TypedData,
  TypedDataDefinition,
} from 'viem'
import { bytesToHex, hexToBytes, isAddress, isAddressEqual } from 'viem'
import type { UserOperationReceipt } from 'viem/account-abstraction'
import { publicKeyToAddress } from 'viem/utils'
import {
  asSwigNamespace,
  locateSwig,
  locateSwigById,
  locateSwigWallet,
  MANAGED_SWIG_NAMESPACES,
} from '../accounts/solana/address'
import { compressP256PublicKey } from '../accounts/solana/passkey'
import { parseCaip2, toEvmChainReference } from '../chains/caip2'
import { getChainById, getChainReference } from '../chains/catalog'
import type {
  DestinationChain,
  SolanaAddress,
  SolanaChain,
} from '../chains/non-evm'
import { normalizeTokenAddress } from '../chains/tokens'
import {
  isSolanaAccountAlreadyCreated,
  isSolanaAuthorityChangeRefused,
} from '../clients/orchestrator/errors'
import type {
  HyperCoreAction,
  Portfolio,
  Quote,
  SigningProof,
  SigningRequest,
  SwigAuthority,
} from '../clients/orchestrator/public'
import type {
  OrchestratorExecutionQuote,
  OrchestratorSwigInitData,
} from '../clients/orchestrator/types'
import type {
  AccountTransaction,
  CallInput,
  EvmAccountConfig,
  EvmOriginTransaction,
  EvmTransaction,
  RhinestoneAccountConfig,
  SameChainSolanaAuthorityTransaction,
  SameChainSolanaTransaction,
  Session,
  SignerSet,
  SolanaAuthorityStatus,
  SolanaManagedAccountConfig,
  SolanaOwner,
  SolanaStandaloneAccountConfig,
  Sponsorship,
  SwapQuoter,
  SwapQuoterFilter,
  Transaction,
  UserOperationTransaction,
} from '../config/account'
import { createStaticAccountRuntime } from '../config/account-runtime'
import type { AccountConstructionInput } from '../config/input'
import type { LegacyAccountConfig } from '../config/legacy'
import {
  materializeAccountInvocationContext,
  resolveAccountConfig,
} from '../config/resolve'
import type {
  AccountInvocationContext,
  ResolvedSdkConfig,
} from '../config/resolved'
import {
  AccountVmNotConfiguredError,
  ManagedSolanaAccountNotSupportedError,
  UnsupportedAccountCapabilityError,
} from '../errors/capability'
import {
  IndependentSigningNotSupportedError,
  InvalidSolanaTransactionArtifactError,
  MismatchedOwnerSignaturesError,
  QuoteNotInPreparedTransactionError,
} from '../errors/execution'
import { resolveHyperCoreAction } from '../hypercore/resolve'
import type { HyperCoreOptions } from '../hypercore/types'
import {
  ecdsaSignerId,
  webauthnSignerId,
} from '../modules/validators/signer-id'
import type { SessionDetails } from '../modules/validators/smart-sessions/types'
import type {
  OwnerSignature,
  OwnerSignerSelection,
  SignAsOwnerOptions,
} from '../signing/types'
import {
  asIntentRecipient,
  projectIntentAccount,
  projectIntentRecipient,
} from '../transactions/intents/account'
import {
  assertPreparedBinding,
  projectCompatibleQuote,
  projectPreparedBinding,
  restorePreparedBinding,
} from '../transactions/intents/compatibility'
import { normalizeIntentQuote } from '../transactions/intents/normalize'
import { assertSupportedSigningRequests } from '../transactions/intents/prepare'
import {
  SOLANA_AUTHORITY_SPONSORSHIP,
  type SolanaEvmExecution,
  type SolanaTransferInput,
  solanaChainId,
} from '../transactions/intents/solana'
import type {
  PreparedSolanaDeployment,
  SolanaDeploymentInput,
} from '../transactions/intents/solana-deployment'
import { normalizeSolanaInstructions } from '../transactions/intents/solana-instructions'
import type {
  IndexedProofContribution,
  IntentInput,
  IntentStatus,
  PreparedIntent,
  PreparedTransactionData,
  QuoteSelection,
  SignedIntent,
  SignedTransactionData,
  TransactionResult,
  TransactionStatus,
} from '../transactions/intents/types'
import type {
  PreparedUserOperation,
  PreparedUserOperationData,
  SignedUserOperationData,
  UserOperationResult,
} from '../transactions/user-operations/types'
import type { CoreComposition, SolanaWorkflows } from './compose-types'
import { toPublicTransactionStatus } from './project-mappers'
import {
  adaptSignerSelection,
  adaptUserOperationSignerSelection,
} from './signer-selection'
import {
  isCrossChainSolanaOrigin,
  isSolanaAuthorityChange,
  isSolanaInstructionExecution,
  isSolanaOrigin,
  normalizeAuthorityChange,
  normalizeTransaction,
} from './transaction-input'

interface SubmitTransactionOptions {
  /**
   * When `true`, the orchestrator validates the intent without executing it
   * onchain. Internal use only; the `internal_` prefix marks it as not part
   * of the supported public API.
   */
  internal_dryRun?: boolean
}

export interface SignedIntentData {
  /** One proof per signing request, in the requested order. */
  proofs: SigningProof[]
}

type Compat = LegacyAccountConfig<unknown>

type AccountVm = 'evm' | 'solana'
type DefaultAccountConfig = Readonly<{ evm: EvmAccountConfig }>
type ConfiguredVm<C> = Extract<keyof C, AccountVm>
type NativeAddress<Vm extends AccountVm> = Vm extends 'evm'
  ? Address
  : SolanaAddress
type RequiredBranch<C, Vm extends AccountVm> = [C] extends [
  Readonly<Record<Vm, infer Branch>>,
]
  ? Branch
  : never
type HasManagedEvm<C> = [RequiredBranch<C, 'evm'>] extends [never]
  ? false
  : [RequiredBranch<C, 'evm'>] extends [EvmAccountConfig]
    ? true
    : false
type HasManagedSolana<C> = [RequiredBranch<C, 'solana'>] extends [never]
  ? false
  : [RequiredBranch<C, 'solana'>] extends [SolanaManagedAccountConfig]
    ? true
    : false

/** Address access shared by every account handle. */
export interface RhinestoneAccountBase<
  C extends RhinestoneAccountConfig = DefaultAccountConfig,
> {
  /** Captured composite configuration. VM membership is shallowly immutable. */
  config: Readonly<C>
  /**
   * Get the native address for a configured VM.
   * @param vm Configured VM to read
   * @returns The account or receiver address in that VM's native format
   * @throws AccountVmNotConfiguredError when a widened input names an absent VM
   */
  getAddress<const Vm extends ConfiguredVm<C>>(
    vm: Vm,
  ): C extends Readonly<Record<Vm, unknown>>
    ? NativeAddress<Vm>
    : NativeAddress<Vm> | undefined
}

/** Intent transaction lifecycle exposed by accounts with a managed source. */
export interface ManagedTransactionAccount<
  _C extends RhinestoneAccountConfig = DefaultAccountConfig,
> {
  /**
   * Prepare an intent transaction for signing.
   *
   * On an account with a managed Solana entry, `{ destination: { chain, authority } }` adds or
   * removes a passkey or ECDSA key on its Swig (see `addPasskey` and
   * `addEcdsaKey`). That change is always gas-sponsored and billed to the
   * integrator's sponsorship.
   * @param transaction Transaction to prepare
   * @returns The prepared transaction data
   * @see {@link signTransaction} to sign the prepared transaction
   * @see {@link submitTransaction} to submit the signed transaction
   */
  prepareTransaction(
    transaction: AccountTransaction<_C>,
  ): Promise<PreparedTransactionData>
  /**
   * Get the authorisations a prepared transaction needs, in order.
   * @param preparedTransaction Prepared transaction data
   * @param options Optional override; pass `{ intentId }` to inspect a specific quote from `preparedTransaction.quotes.all`
   * @returns The quote's ordered signing requests; proofs are submitted in the same order
   * @see {@link prepareTransaction} to prepare the transaction data for signing
   */
  getTransactionMessages(
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ): SigningRequest[]
  /**
   * Sign a prepared transaction as one configured owner. The returned signature
   * can be serialized and shared with the party coordinating submission.
   * @param preparedTransaction Prepared transaction data
   * @param options Owner account, optional quote, and multi-factor validator ID
   * @returns This owner's signature contribution
   * @see {@link prepareTransaction} to prepare the transaction data for signing
   * @see {@link assembleTransaction} to combine independent owner signatures
   */
  signTransaction(
    preparedTransaction: PreparedTransactionData,
    options: SignAsOwnerOptions,
  ): Promise<OwnerSignature>
  /**
   * Sign a prepared transaction with the transaction's configured signers.
   * @param preparedTransaction Prepared transaction data
   * @param options Optional override; pass `{ intentId }` to sign a specific quote from `preparedTransaction.quotes.all`
   * @returns The signed transaction data
   * @see {@link prepareTransaction} to prepare the transaction data for signing
   * @see {@link submitTransaction} to submit the signed transaction
   */
  signTransaction(
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ): Promise<SignedTransactionData>
  /**
   * Assemble independently collected owner signatures into a signed transaction.
   * Signatures are deduplicated and ordered according to the configured owner set.
   * Account thresholds are read from the local configuration; an explicit
   * transaction signer set determines active MFA IDs and contributing owners.
   * Callers must keep these synchronized with onchain owner and threshold changes.
   * @param preparedTransaction The prepared transaction every owner signed
   * @param signatures Owner signatures returned by `signTransaction` with an `owner` option
   * @returns Signed transaction data ready for submission
   * @see {@link signTransaction} to create each owner signature
   * @see {@link submitTransaction} to submit the result
   */
  assembleTransaction(
    preparedTransaction: PreparedTransactionData,
    signatures: OwnerSignature[],
    options?: { proofs?: IndexedProofContribution[] },
  ): Promise<SignedTransactionData>
  /**
   * Sign the EIP-7702 delegations a prepared transaction's quote asks for.
   *
   * Advanced: `signTransaction` already collects these, so a normal caller
   * never needs this. Use it when the delegation signer is a different party
   * from the account owners, and pass the result to `assembleTransaction`.
   * @param preparedTransaction Prepared transaction data
   * @param options Optional override; pass `{ intentId }` to target a specific quote
   * @returns Delegation proofs bound to the quote and their request slots
   * @see {@link assembleTransaction} to combine them with owner signatures
   */
  signAuthorizations(
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ): Promise<IndexedProofContribution[]>
  /**
   * Submit a signed transaction.
   * @param signedTransaction Signed transaction data
   * @param options Optional submission options
   * @returns The transaction result (an intent ID)
   * @see {@link signTransaction} to sign the transaction data
   * @see {@link waitForExecution} to wait for the transaction to execute onchain
   */
  submitTransaction(
    signedTransaction: SignedTransactionData,
    options?: SubmitTransactionOptions,
  ): Promise<TransactionResult>
  /** Wait for a submitted intent to reach a terminal state. */
  waitForExecution(result: TransactionResult): Promise<TransactionStatus>
}

/**
 * A managed Solana account without a managed EVM account.
 *
 * It may carry an address-only EVM receiver for delivery defaults. It signs
 * each Solana spend with its one owner, so it has no independent owner signing,
 * assembly, EIP-7702 authorizations or submission options.
 */
export interface SolanaStandaloneAccount<
  C extends RhinestoneAccountConfig = Readonly<{
    solana: SolanaStandaloneAccountConfig
  }>,
> extends RhinestoneAccountBase<C> {
  /**
   * Prepare a Solana-origin transaction for signing.
   *
   * `{ destination: { chain, authority } }` adds or removes a passkey or ECDSA key on the
   * account's Swig (see `addPasskey` and `addEcdsaKey`). That change is always
   * gas-sponsored and billed to the integrator's sponsorship.
   * @param transaction Transaction to prepare
   * @returns The prepared transaction data
   */
  prepareTransaction(
    transaction: AccountTransaction<C>,
  ): Promise<PreparedTransactionData>
  /**
   * Get the one spend authorisation a prepared transaction needs.
   * @param preparedTransaction Prepared transaction data
   * @param options Optional override; pass `{ intentId }` to inspect a specific quote from `preparedTransaction.quotes.all`
   * @returns The quote's signing requests
   */
  getTransactionMessages(
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ): SigningRequest[]
  /**
   * Sign a prepared transaction with the account's owner.
   * @param preparedTransaction Prepared transaction data
   * @param options Optional override; pass `{ intentId }` to sign a specific quote from `preparedTransaction.quotes.all`
   * @returns The signed transaction data
   */
  signTransaction(
    preparedTransaction: PreparedTransactionData,
    options?: QuoteSelection,
  ): Promise<SignedTransactionData>
  /**
   * Submit a signed transaction.
   * @param signedTransaction Signed transaction data
   * @returns The transaction result (an intent ID)
   */
  submitTransaction(
    signedTransaction: SignedTransactionData,
  ): Promise<TransactionResult>
  /** Wait for a submitted intent to reach a terminal state. */
  waitForExecution(result: TransactionResult): Promise<TransactionStatus>
  /**
   * Check whether a Swig authority change is already in place, without
   * signing or submitting anything.
   *
   * Quotes the change as `prepareTransaction` would, discards the quote, and
   * reads the orchestrator's answer: `applied` when the key is present with
   * exactly the requested permission (or gone, for a removal), `notApplied`
   * when the change is still to make, and `conflict` when the key is present
   * with another or unreadable permission. Only `applied` means ready.
   *
   * The quote needs a configured owner able to manage authorities (`All` or
   * `ManageAuthority`). Under JWT auth it mints one sponsorship grant that is
   * never used. `notApplied` says nothing about an intent still in flight:
   * settle the original with `waitForExecution` or `getIntentStatus` first,
   * and never resubmit a change that may have landed.
   * @param transaction The `{ destination: { chain, authority } }` change to check
   * @returns The change's status on the Swig
   * @throws SolanaAuthorityChangeRefusedError when the orchestrator refuses the change for any other reason, such as `acting_permission` or `root_role`
   * @throws SolanaAccountNotCreatedError when the Swig does not exist yet
   * @throws UnsupportedAccountCapabilityError when `transaction` is not a Solana authority change
   * @example
   * ```ts
   * import { addEcdsaKey, solanaDevnet } from '@rhinestone/sdk/solana'
   *
   * const enroll = {
   *   destination: {
   *     chain: solanaDevnet,
   *     authority: addEcdsaKey(recoveryPublicKey, { permission: 'manageAuthority' }),
   *   },
   * }
   * const { status } = await account.getAuthorityStatus(enroll)
   * if (status === 'notApplied') {
   *   const signed = await account.signTransaction(await account.prepareTransaction(enroll))
   *   await account.waitForExecution(await account.submitTransaction(signed))
   * }
   * ```
   */
  getAuthorityStatus(
    transaction: SameChainSolanaAuthorityTransaction,
  ): Promise<SolanaAuthorityStatus>
  /**
   * Create the account's Swig on a Solana cluster and wait for it to complete.
   *
   * Creation runs as a sponsored deployment intent. Nothing is signed: the
   * configured Solana owner is installed as the Swig's root authority.
   *
   * Creation is one-shot and cannot be repaired. The root authority is
   * permanent, so a Swig created with the wrong owner permanently strands its
   * wallet, including anything already sent to it. Each creation is billed to
   * the integrator's gas sponsorship, which pays the rent and fees.
   *
   * Without a managed EVM account the Swig is always independent, so `swigId`,
   * the id it was minted with by `createSolanaSwigId()`, is required. On an
   * account that also manages EVM, the Swig derived from the EVM account needs
   * no id; any other Swig still needs its saved one. An id that does not derive
   * the configured `swig` is refused before anything is sent.
   *
   * A Swig that already exists resolves `true` without creating anything. Its
   * root authority is not checked, and a Swig whose root is not the configured
   * owner cannot be spent by it.
   * @param vm `'solana'`
   * @param chain Solana cluster to create the Swig on (`solanaDevnet` or `solanaMainnet`)
   * @param options `swigId`, the 32-byte hex id saved with the configured `swig`; optional only for the Swig derived from a managed EVM account
   * @returns `true` once the Swig exists
   * @throws IntentFailedError when the deployment intent fails
   * @throws UnsupportedAccountCapabilityError when the Swig id is missing or wrong, or an ECDSA owner exposes no public key
   * @throws ManagedSolanaAccountNotSupportedError outside the environment and endpoint the account was created against
   * @example
   * ```ts
   * import { createSolanaSwigId, solanaDevnet } from '@rhinestone/sdk/solana'
   *
   * // Once, when provisioning: save `id` and `swig` together.
   * const { id, swig } = createSolanaSwigId()
   *
   * const account = await sdk.createAccount({
   *   solana: { owner: { type: 'ecdsa', account: owner }, swig },
   * })
   * await account.deploy('solana', solanaDevnet, { swigId: id })
   * ```
   * @see {@link createSolanaSwigId} to mint an independent Swig
   */
  deploy(
    vm: 'solana',
    chain: SolanaChain,
    options: Required<SolanaDeployOptions>,
  ): Promise<boolean>
}

/** Options for deploying a managed EVM account with `deploy('evm', …)`. */
export interface EvmDeployOptions {
  /** Sponsor the deployment. A sponsored intent deployment spends nothing. */
  sponsored?: boolean
  /**
   * The token an unsponsored intent deployment pays in, as an address on the
   * deployment chain. Required then; ignored when the deployment runs as a
   * UserOperation.
   */
  source?: { token: Address }
}

/** Options for `setup`. */
export interface EvmSetupOptions {
  /**
   * The token an intent-path setup pays in, as an address on the setup chain.
   * Required then; ignored when setup runs as a UserOperation.
   */
  source?: { token: Address }
}

/** Options for creating a managed Solana account's Swig. */
export interface SolanaDeployOptions {
  /**
   * The 32-byte Swig id, as 0x-prefixed hex, returned by `createSolanaSwigId()`
   * together with the configured `swig`. Optional only on an account with a
   * managed EVM account, and there only for the Swig derived from it.
   */
  swigId?: Hex
}

/**
 * Swig creation and authority checks on an account that manages both EVM and
 * Solana, alongside its EVM `deploy`.
 */
interface ManagedSolanaDeployment {
  /**
   * Create the Swig of the account's managed Solana entry and wait for it to
   * complete.
   *
   * Creation runs as a sponsored deployment intent. Nothing is signed: the
   * configured Solana owner is installed as the Swig's root authority.
   *
   * Creation is one-shot and cannot be repaired. The root authority is
   * permanent, so a Swig created with the wrong owner permanently strands its
   * wallet, including anything already sent to it. Each creation is billed to
   * the integrator's gas sponsorship, which pays the rent and fees.
   *
   * The Swig derived from the managed EVM account needs no id: the SDK computes
   * it. Any other Swig needs the id it was minted with by `createSolanaSwigId()`,
   * and a missing id, or one that does not derive the configured `swig`, is
   * refused before anything is sent.
   *
   * A Swig that already exists resolves `true` without creating anything. Its
   * root authority is not checked, and a Swig whose root is not the configured
   * owner cannot be spent by it.
   * @param vm `'solana'`
   * @param chain Solana cluster to create the Swig on (`solanaDevnet` or `solanaMainnet`)
   * @param options Optional `swigId`, the 32-byte hex id saved with the configured `swig`
   * @returns `true` once the Swig exists
   * @throws IntentFailedError when the deployment intent fails
   * @throws UnsupportedAccountCapabilityError when the Swig id is missing or wrong, or an ECDSA owner exposes no public key
   * @throws ManagedSolanaAccountNotSupportedError outside the environment and endpoint the account was created against
   * @example
   * ```ts
   * await account.deploy('solana', solanaDevnet)
   * ```
   * @see {@link createSolanaSwigId} to mint an independent Swig
   */
  deploy(
    vm: 'solana',
    chain: SolanaChain,
    options?: SolanaDeployOptions,
  ): Promise<boolean>
  /**
   * Check whether a Swig authority change is already in place, without
   * signing or submitting anything.
   *
   * Quotes the change as `prepareTransaction` would, discards the quote, and
   * reads the orchestrator's answer: `applied` when the key is present with
   * exactly the requested permission (or gone, for a removal), `notApplied`
   * when the change is still to make, and `conflict` when the key is present
   * with another or unreadable permission. Only `applied` means ready.
   *
   * The quote needs a configured owner able to manage authorities (`All` or
   * `ManageAuthority`). Under JWT auth it mints one sponsorship grant that is
   * never used. `notApplied` says nothing about an intent still in flight:
   * settle the original with `waitForExecution` or `getIntentStatus` first,
   * and never resubmit a change that may have landed.
   * @param transaction The `{ destination: { chain, authority } }` change to check
   * @returns The change's status on the Swig
   * @throws SolanaAuthorityChangeRefusedError when the orchestrator refuses the change for any other reason, such as `acting_permission` or `root_role`
   * @throws SolanaAccountNotCreatedError when the Swig does not exist yet
   * @throws UnsupportedAccountCapabilityError when `transaction` is not a Solana authority change
   * @example
   * ```ts
   * import { addEcdsaKey, solanaDevnet } from '@rhinestone/sdk/solana'
   *
   * const enroll = {
   *   destination: {
   *     chain: solanaDevnet,
   *     authority: addEcdsaKey(recoveryPublicKey, { permission: 'manageAuthority' }),
   *   },
   * }
   * const { status } = await account.getAuthorityStatus(enroll)
   * if (status === 'notApplied') {
   *   const signed = await account.signTransaction(await account.prepareTransaction(enroll))
   *   await account.waitForExecution(await account.submitTransaction(signed))
   * }
   * ```
   */
  getAuthorityStatus(
    transaction: SameChainSolanaAuthorityTransaction,
  ): Promise<SolanaAuthorityStatus>
}

/** Full EVM management, signing, UserOperation and account-read capabilities. */
export interface ManagedEvmAccount<
  C extends RhinestoneAccountConfig = DefaultAccountConfig,
> extends ManagedTransactionAccount<C> {
  /** The captured composite account configuration. */
  config: Readonly<C>
  /**
   * Deploy the EVM account on a given chain.
   *
   * An account deployed through an intent pays for it on the same chain: a
   * sponsored deployment spends nothing, and an unsponsored one spends
   * `source.token`, which it then requires. A deployment that runs as a
   * UserOperation takes neither.
   * @param vm `'evm'`
   * @param chain Chain to deploy the account on
   * @param params Optional sponsorship, and the token an unsponsored deployment pays in
   * @returns `true` once the deployment is submitted, `false` when the account is already deployed
   * @throws UnsupportedAccountCapabilityError when an unsponsored intent deployment names no `source.token`
   * @example
   * ```ts
   * await account.deploy('evm', base, { sponsored: true })
   * await account.deploy('evm', base, { source: { token: usdcOnBase } })
   * ```
   */
  deploy(vm: 'evm', chain: Chain, params?: EvmDeployOptions): Promise<boolean>
  /**
   * Check whether the account is deployed on a given chain.
   * @param chain Chain to check
   * @returns `true` if the account is deployed, `false` otherwise
   */
  isDeployed(chain: Chain): Promise<boolean>
  /**
   * Set up an existing account on a given chain by installing any missing modules.
   *
   * Setup that runs as an intent pays for itself in `source.token` on the same
   * chain, and requires it. Setup that installs the intent executor runs as a
   * UserOperation and takes no source.
   * @param chain Chain to set the account up on
   * @param options The token an intent-path setup pays in
   * @returns `true` once setup is submitted, `false` when nothing is missing
   * @throws UnsupportedAccountCapabilityError when an intent-path setup names no `source.token`
   * @example
   * ```ts
   * await account.setup(base, { source: { token: usdcOnBase } })
   * ```
   */
  setup(chain: Chain, options?: EvmSetupOptions): Promise<boolean>
  /**
   * Get the account initialization data, used to deploy the account onchain.
   * @returns The factory address and factory data
   */
  getInitData(): { factory: Address; factoryData: Hex }
  /**
   * Prepare and sign the EIP-7702 account initialization data.
   * @returns The init data signature
   */
  signEip7702InitData(): Promise<Hex>
  /**
   * Sign a message (EIP-191).
   * @param message Message to sign
   * @param chain Chain to sign the message for
   * @param signers Signers to use, or `undefined` for the account default
   * @returns The signature
   * @see {@link signTypedData} to sign EIP-712 typed data
   */
  signMessage(
    message: SignableMessage,
    chain: Chain,
    signers: SignerSet | undefined,
  ): Promise<Hex>
  /**
   * Sign typed data (EIP-712).
   * @param parameters Typed-data parameters
   * @param chain Chain to sign the typed data for
   * @param signers Signers to use, or `undefined` for the account default
   * @returns The signature
   * @see {@link signMessage} to sign an EIP-191 message
   */
  signTypedData<
    typedData extends TypedData | Record<string, unknown> = TypedData,
    primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
  >(
    parameters: HashTypedDataParameters<typedData, primaryType>,
    chain: Chain,
    signers: SignerSet | undefined,
  ): Promise<Hex>
  /**
   * Sign an orchestrator intent operation. Used by headless flows that prepare
   * the intent outside the SDK but still need the SDK-owned smart-session
   * signature packing and authorisation routing.
   * @param signingRequests The quote's ordered signing requests
   * @param targetChain Chain where the destination execution runs
   * @param signers Signers to use, or `undefined` for the account default
   * @returns The proofs, in the same order, ready for submission
   * @see {@link signTransaction} for the canonical signing path
   */
  signIntent(
    signingRequests: SigningRequest[],
    targetChain: DestinationChain,
    signers?: SignerSet,
  ): Promise<SignedIntentData>
  /**
   * Prepare a user operation for signing.
   * @param transaction User operation to prepare
   * @returns The prepared user operation data
   * @see {@link signUserOperation} to sign the prepared user operation
   * @see {@link submitUserOperation} to submit the signed user operation
   * @see {@link sendUserOperation} to prepare, sign, and submit in one call
   */
  prepareUserOperation(
    transaction: UserOperationTransaction,
  ): Promise<PreparedUserOperationData>
  /**
   * Sign a prepared user operation.
   * @param preparedUserOperation Prepared user operation data
   * @returns The signed user operation data
   * @see {@link prepareUserOperation} to prepare the user operation data for signing
   * @see {@link submitUserOperation} to submit the signed user operation
   */
  signUserOperation(
    preparedUserOperation: PreparedUserOperationData,
  ): Promise<SignedUserOperationData>
  /**
   * Submit a signed user operation.
   * @param signedUserOperation Signed user operation data
   * @returns The user operation result (a UserOp hash)
   * @see {@link signUserOperation} to sign the user operation data
   * @see {@link waitForExecution} to wait for the user operation to execute onchain
   */
  submitUserOperation(
    signedUserOperation: SignedUserOperationData,
  ): Promise<UserOperationResult>
  /**
   * Prepare, sign, and submit a user operation in a single call.
   * @param transaction User operation to send
   * @returns The user operation result (a UserOp hash)
   * @see {@link waitForExecution} to wait for the user operation to execute onchain
   */
  sendUserOperation(
    transaction: UserOperationTransaction,
  ): Promise<UserOperationResult>
  /**
   * Wait for a submitted transaction or user operation to execute onchain.
   * Polls the orchestrator until the intent reaches a terminal state; on failure
   * an `IntentFailedError` is thrown, whose `context` carries `operations` and,
   * where a settlement layer returned the funds, `refunds` — a refunded intent
   * is still a failed one, so that error is where the refund surfaces. An
   * intent that carried a HyperCore action also carries `hyperCore` there,
   * which tells a refused trade (safe to retry) from a partial one (check the
   * account first).
   * @param result The result returned by a submit/send call
   * @returns The per-chain operation status (for intents) or a UserOp receipt
   */
  waitForExecution(result: TransactionResult): Promise<TransactionStatus>
  waitForExecution(result: UserOperationResult): Promise<UserOperationReceipt>
  /**
   * Get the native address for a configured VM.
   * @param vm Configured VM to read
   * @returns The account or receiver address in that VM's native format
   * @throws AccountVmNotConfiguredError when a widened input names an absent VM
   */
  getAddress<const Vm extends ConfiguredVm<C>>(
    vm: Vm,
  ): C extends Readonly<Record<Vm, unknown>>
    ? NativeAddress<Vm>
    : NativeAddress<Vm> | undefined
  /**
   * Get the account portfolio (token balances across chains).
   * @param onTestnets Whether to query testnet balances (default is `false`)
   * @returns The account balances
   */
  getPortfolio(onTestnets?: boolean): Promise<Portfolio>
  /**
   * Resolve the smart-session details for a set of sessions.
   * @param sessions Sessions to resolve
   * @returns The resolved session details
   */
  getSessionDetails(sessions: Session[]): Promise<SessionDetails>
  /**
   * Check whether a smart session is enabled on the account.
   * @param session Session to check
   * @returns `true` if the session is enabled
   */
  isSessionEnabled(session: Session): Promise<boolean>
  /**
   * Sign the data required to enable a smart session.
   * @param details Session details to enable
   * @returns The enable-session signature
   */
  signEnableSession(details: SessionDetails): Promise<Hex>
  /**
   * Get the account owners.
   * @remarks Only returns ECDSA owners; owners managed by other validator types are not included.
   * @param chain Chain to read the owners from
   * @returns The owner addresses and threshold, or `null` if unavailable
   */
  getOwners(chain: Chain): Promise<{
    accounts: Address[]
    threshold: number
  } | null>
  /**
   * Get the account validator modules.
   * @param chain Chain to read the validators from
   * @returns The validator module addresses
   */
  getValidators(chain: Chain): Promise<Address[]>
  /**
   * Get the account executor modules.
   * @param chain Chain to read the executors from
   * @returns The executor module addresses
   */
  getExecutors(chain: Chain): Promise<Address[]>
}

/** Account handle whose methods reflect the definitely configured capabilities. */
export type RhinestoneAccount<
  C extends RhinestoneAccountConfig = DefaultAccountConfig,
> = RhinestoneAccountBase<C> &
  (HasManagedEvm<C> extends true
    ? ManagedEvmAccount<C> &
        (HasManagedSolana<C> extends true
          ? ManagedSolanaDeployment
          : Readonly<Record<never, never>>)
    : HasManagedSolana<C> extends true
      ? SolanaStandaloneAccount<C>
      : Readonly<Record<never, never>>)

function cloneArtifactValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(cloneArtifactValue) as T
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        cloneArtifactValue(item),
      ]),
    ) as T
  }
  return value
}

function toPublicQuote(quote: OrchestratorExecutionQuote): Quote {
  const compatible = projectCompatibleQuote(quote)
  return cloneArtifactValue({
    intentId: compatible.intentId,
    purpose: compatible.purpose,
    expiresAt: compatible.expiresAt,
    estimatedFillTime: compatible.estimatedFillTime,
    settlementLayer: compatible.settlementLayer,
    plan: compatible.plan,
    cost: compatible.cost,
    requirements: [...compatible.requirements],
    signingRequests: [...compatible.signingRequests],
    ...(compatible.bridgeFill ? { bridgeFill: compatible.bridgeFill } : {}),
  }) as Quote
}

function toPreparedTransactionData(
  prepared: PreparedIntent<Compat>,
  transaction: Transaction,
  cache: WeakMap<object, PreparedIntent<Compat>>,
): PreparedTransactionData {
  const data: PreparedTransactionData = {
    quotes: {
      traceId: prepared.traceId,
      best: toPublicQuote(prepared.quote),
      all: prepared.quotes.map(toPublicQuote),
    },
    intentInput: prepared.intentInput,
    request: projectPreparedBinding(prepared.request),
    transaction,
  }
  cache.set(data, prepared)
  return data
}

function solanaMetadata(
  input: SolanaTransferInput,
): NonNullable<PreparedTransactionData['execution']> {
  const binding = {
    namespace: input.namespace,
    endpoint: input.endpoint,
    chain: solanaChainId(input.chain),
    caip2: input.chain.caip2,
    accountAddress: input.accountAddress,
    // Omitted, not undefined: persisted JSON drops the key, and the binding
    // check compares key counts.
    ...(input.accountType ? { accountType: input.accountType } : {}),
    authority:
      input.authority.kind === 'secp256k1'
        ? input.authority.address
        : input.authority.publicKey,
    swigAddress: input.swigAddress,
    walletAddress: input.walletAddress,
  }
  const action = input.action
  if (action.kind === 'instructions') {
    return { kind: 'solana-instructions', ...binding }
  }
  if (action.kind === 'authority') {
    const { change } = action
    return {
      kind: 'solana-authority',
      ...binding,
      accountAddress: input.walletAddress,
      action: change.action,
      keyType: change.keyType,
      key: change.key,
      ...(change.permission ? { permission: change.permission } : {}),
    }
  }
  const delivery = action.delivery
  return delivery.kind === 'cross-chain'
    ? {
        kind: 'solana-cross-chain',
        ...binding,
        mint: action.mint,
        destinationChain: delivery.chainId,
        destinationToken: delivery.token,
        recipient: delivery.recipient,
      }
    : {
        kind: 'solana',
        ...binding,
        mint: action.mint,
        recipient: delivery.recipient,
      }
}

function toPreparedSolanaTransactionData(
  prepared: import('../transactions/intents/solana').PreparedSolanaIntent,
  transaction: Transaction,
): PreparedTransactionData {
  return {
    quotes: {
      traceId: prepared.traceId,
      best: toPublicQuote(prepared.quote),
      all: prepared.quotes.map(toPublicQuote),
    },
    execution: solanaMetadata(prepared.input),
    intentInput: prepared.intentInput,
    request: projectPreparedBinding(prepared.request),
    transaction,
  }
}

function selectedPublicQuote(
  prepared: PreparedTransactionData,
  intentId?: string,
): Quote {
  if (!intentId) return prepared.quotes.best
  const quote = prepared.quotes.all.find(
    (candidate) => candidate.intentId === intentId,
  )
  if (!quote) {
    throw new QuoteNotInPreparedTransactionError({ context: { intentId } })
  }
  return quote
}

function reconstructInput(
  context: AccountInvocationContext<Compat>,
  prepared: PreparedTransactionData,
  intentId?: string,
): Parameters<
  ReturnType<
    CoreComposition<Compat>['createAccount']
  >['workflows']['reconstructPreparedIntent']
>[1] {
  const selected = selectedPublicQuote(prepared, intentId)
  const quote = normalizeIntentQuote(selected as OrchestratorExecutionQuote)
  return {
    traceId: prepared.quotes.traceId,
    approvalInput: prepared.intentInput,
    quote,
    quotes: prepared.quotes.all.map((candidate) =>
      candidate.intentId === quote.intentId
        ? quote
        : normalizeIntentQuote(candidate as OrchestratorExecutionQuote),
    ),
    // The persisted Caucasus request, not a reconstruction from `intentInput`:
    // that projection is lossy about account capability and signing state, and
    // an artifact from an earlier wire version is refused here rather than
    // silently reinterpreted.
    request: restorePreparedBinding(prepared.request),
    intentInput: adaptTransaction(context, prepared.transaction),
  }
}

function toSignedTransactionData(
  prepared: PreparedTransactionData,
  signed: SignedIntent<Compat>,
  cache: WeakMap<object, SignedIntent<Compat>>,
): SignedTransactionData {
  const data: SignedTransactionData = {
    ...prepared,
    quote: toPublicQuote(signed.prepared.quote),
    proofs: [...signed.proofs],
  }
  cache.set(data, signed)
  return data
}

/**
 * Refuses an artifact from an earlier SDK or wire generation before its
 * transaction is read, then validates the transaction against the current
 * model.
 */
function assertPreparedArtifact(
  prepared: PreparedTransactionData,
  config: Readonly<RhinestoneAccountConfig>,
): void {
  assertPreparedBinding(prepared?.request)
  normalizeTransaction(prepared.transaction, config)
}

/** The same-chain fee token an intent-path deployment or setup spends. */
function setupSourceToken(
  options: { readonly source?: { readonly token?: unknown } } | undefined,
  chain: Chain,
): { readonly sourceToken?: Address } {
  const source = options?.source
  if (source === undefined) return {}
  if (
    typeof source !== 'object' ||
    source === null ||
    Object.keys(source).some((key) => key !== 'token') ||
    typeof source.token !== 'string' ||
    !isAddress(source.token)
  ) {
    throw new UnsupportedAccountCapabilityError(
      `\`source\` must be \`{ token }\`, a token address on ${chain.name ?? `chain ${chain.id}`} that pays for the setup.`,
      { field: 'source.token', chainId: chain.id },
    )
  }
  return { sourceToken: source.token }
}

function referenceChain(): import('../chains/types').EvmChainReference {
  // Account addresses are CREATE2 and chain-independent, so initialization only
  // needs some EVM chain reference. With no bundled chain set, use mainnet.
  return toEvmChainReference(1)
}

export function createAccountFacade<C extends RhinestoneAccountConfig>(
  compatibilityConfig: LegacyAccountConfig<unknown>,
  publicConfig: Readonly<C>,
  composition: CoreComposition<LegacyAccountConfig<unknown>>,
): ManagedEvmAccount<C> & ManagedSolanaDeployment {
  // Intent identity caches are facade-scoped. Values crossing account/SDK
  // instances are reconstructed and validated by the receiving account.
  const preparedIntents = new WeakMap<object, PreparedIntent<Compat>>()
  const signedIntents = new WeakMap<object, SignedIntent<Compat>>()
  const context = (
    method: AccountInvocationContext<LegacyAccountConfig<unknown>>['method'],
  ) =>
    materializeAccountInvocationContext(
      composition.config,
      compatibilityConfig,
      method,
    )
  const workflowsFor = (
    ctx: AccountInvocationContext<LegacyAccountConfig<unknown>>,
  ) => composition.createAccount(ctx).workflows
  const solana = (() => {
    const branch = publicConfig.solana
    if (!branch || !('owner' in branch) || !branch.owner) return undefined
    const ctx = context('get-address')
    const identity = workflowsFor(ctx).getAddress(ctx, referenceChain())
    const kind = ctx.account.account.kind
    return createSolanaOrigin(
      {
        owner: branch.owner,
        walletAddress: locateSwigWallet(branch.swig).address,
        swigAddress: branch.swig,
        environment: ctx.sdk.environment,
        endpoint: ctx.sdk.orchestratorUrl,
        evmRecipient: identity,
        evmExecution: {
          address: identity,
          accountType:
            kind === 'eoa' ? 'EOA' : kind === 'hca' ? 'GENERIC' : 'ERC7579',
        },
      },
      publicConfig,
    )
  })()
  const requireSolana = () => {
    if (!solana) {
      throw new UnsupportedAccountCapabilityError(
        'A managed Solana source is not configured on this account.',
        { vm: 'solana' },
      )
    }
    return solana
  }

  const resolvePrepared = (
    ctx: AccountInvocationContext<Compat>,
    prepared: PreparedTransactionData,
    intentId?: string,
  ): Promise<PreparedIntent<Compat>> => {
    assertPreparedArtifact(prepared, publicConfig)
    if (!isSolanaOrigin(prepared.transaction)) {
      // Before any account state is read: a quote this SDK cannot sign should
      // not cost an RPC round trip first.
      assertSupportedSigningRequests(
        selectedPublicQuote(prepared, intentId).signingRequests,
      )
    }
    const cached = preparedIntents.get(prepared)
    if (cached && !intentId) return Promise.resolve(cached)
    return workflowsFor(ctx).reconstructPreparedIntent(
      ctx,
      reconstructInput(ctx, prepared, intentId),
    )
  }

  const account: ManagedEvmAccount<C> & ManagedSolanaDeployment = {
    config: publicConfig,
    deploy: (async (
      vm: AccountVm,
      chain: Chain | SolanaChain,
      params?: EvmDeployOptions | SolanaDeployOptions,
    ) => {
      if (vm === 'solana') {
        const solana = requireSolana()
        const ctx = context('deploy')
        const workflows = workflowsFor(ctx)
        return solana.deploy(
          ctx.sdk,
          workflows,
          (intentId) => workflows.waitForIntentStatus(ctx, intentId),
          chain as SolanaChain,
          params as SolanaDeployOptions | undefined,
        )
      }
      if (vm !== 'evm') throw new AccountVmNotConfiguredError(String(vm))
      if ((chain as { kind?: unknown }).kind === 'svm') {
        throw new UnsupportedAccountCapabilityError(
          "An EVM deployment needs an EVM chain; create a Swig with `deploy('solana', chain)`.",
          { vm: 'evm' },
        )
      }
      const ctx = context('deploy')
      const options = params as EvmDeployOptions | undefined
      return workflowsFor(ctx).deploy(
        ctx,
        toEvmChainReference((chain as Chain).id),
        {
          ...(options?.sponsored !== undefined
            ? { sponsored: options.sponsored }
            : {}),
          ...setupSourceToken(options, chain as Chain),
        },
      )
    }) as ManagedEvmAccount<C>['deploy'] & ManagedSolanaDeployment['deploy'],
    async getAuthorityStatus(transaction) {
      const origin = requireSolana()
      const ctx = context('prepare-intent')
      return origin.authorityStatus(
        ctx.sdk,
        workflowsFor(ctx),
        normalizeAuthorityChange(transaction, publicConfig),
      )
    },
    isDeployed(chain) {
      const ctx = context('is-deployed')
      return workflowsFor(ctx).isDeployed(ctx, toEvmChainReference(chain.id))
    },
    setup(chain, options) {
      const ctx = context('setup')
      return workflowsFor(ctx).setup(
        ctx,
        toEvmChainReference(chain.id),
        setupSourceToken(options, chain),
      )
    },
    getInitData() {
      const ctx = context('get-init-data')
      return workflowsFor(ctx).getInitData(ctx)
    },
    async signEip7702InitData() {
      const ctx = context('sign-eip7702-init-data')
      const result = await workflowsFor(ctx).signEip7702InitData(ctx)
      return result.signature
    },
    async prepareTransaction(transaction) {
      const ctx = context('prepare-intent')
      const initiallyNormalized = normalizeTransaction(
        transaction,
        publicConfig,
      )
      const target = (
        initiallyNormalized as { destination: Record<string, unknown> }
      ).destination
      const normalized =
        !isSolanaOrigin(initiallyNormalized) &&
        (target.chain as { kind?: unknown }).kind === 'svm' &&
        target.recipient === undefined &&
        solana
          ? (Object.freeze({
              ...initiallyNormalized,
              destination: Object.freeze({
                ...target,
                recipient: solana.walletAddress,
              }),
            }) as unknown as Transaction)
          : initiallyNormalized
      if (isSolanaOrigin(normalized)) {
        const origin = requireSolana()
        const workflows = workflowsFor(ctx)
        let execution: SolanaEvmExecution | undefined
        if (
          isCrossChainSolanaOrigin(normalized) &&
          normalized.destination.calls?.length
        ) {
          origin.assertDestinationCallsSupported()
          const { destination } = normalized
          const chainId = destination.chain.id
          const resolved = await workflows.resolveSolanaEvmDestination(ctx, {
            chain: toEvmChainReference(chainId),
            calls: destination.calls!.map((call) => adaptCall(call, chainId)),
            ...(normalized.eip7702InitSignature
              ? { eip7702InitSignature: normalized.eip7702InitSignature }
              : {}),
          })
          // Lazy calls can resolve to none, which leaves a plain delivery.
          execution =
            resolved.calls.length > 0
              ? {
                  ...resolved,
                  ...(destination.gasLimit === undefined
                    ? {}
                    : { gasLimit: destination.gasLimit }),
                }
              : undefined
        }
        return origin.prepare(ctx.sdk, workflows, normalized, execution)
      }
      // Before the quote, not after: the quote's signing requests register an agent
      // derived from the action's bytes, so the action has to be concrete here.
      const hyperCoreAction = await resolveHyperCoreAction({
        options: (target as { hyperCore?: HyperCoreOptions }).hyperCore,
        account: workflowsFor(ctx).getAddress(ctx, referenceChain()),
        ...(ctx.sdk.hyperliquid ? { hyperliquid: ctx.sdk.hyperliquid } : {}),
      })
      const prepared = await workflowsFor(ctx).prepareIntent(
        ctx,
        adaptTransaction(ctx, normalized, hyperCoreAction),
      )
      return toPreparedTransactionData(prepared, normalized, preparedIntents)
    },
    getTransactionMessages(preparedTransaction, options) {
      assertPreparedArtifact(preparedTransaction, publicConfig)
      const quote = selectedPublicQuote(preparedTransaction, options?.intentId)
      if (isSolanaOrigin(preparedTransaction.transaction)) {
        const ctx = context('get-intent-messages')
        requireSolana().resolve(
          ctx.sdk,
          workflowsFor(ctx),
          preparedTransaction,
          options?.intentId,
        )
      }
      return [...quote.signingRequests]
    },
    signTransaction: (async (
      preparedTransaction: PreparedTransactionData,
      options?: QuoteSelection | SignAsOwnerOptions,
    ): Promise<SignedTransactionData | OwnerSignature> => {
      assertPreparedArtifact(preparedTransaction, publicConfig)
      const ctx = context('sign-intent')
      const workflows = workflowsFor(ctx)
      if (isSolanaOrigin(preparedTransaction.transaction)) {
        return requireSolana().sign(
          ctx.sdk,
          workflows,
          preparedTransaction,
          options,
          async (signingRequests, chainId) =>
            (
              await workflows.signIntentFromRequests(ctx, {
                signingRequests,
                targetChain: toEvmChainReference(chainId),
              })
            ).proofs,
        )
      }
      if (options && 'owner' in options) {
        // Independent owner signing is unsupported for smart-session intents;
        // reject before resolving sessions (which would issue an RPC read),
        // matching the legacy fast-fail.
        if (preparedTransaction.transaction.signers?.type === 'session') {
          throw new IndependentSigningNotSupportedError()
        }
        const signerId = signerIdForOwner(options.owner)
        const internal = await resolvePrepared(
          ctx,
          preparedTransaction,
          options.intentId,
        )
        return workflows.signIntentAsOwner(ctx, internal, {
          signerId,
          ...(options.validatorId === undefined
            ? {}
            : { validatorId: options.validatorId }),
        }) as unknown as Promise<OwnerSignature>
      }
      const internal = await resolvePrepared(
        ctx,
        preparedTransaction,
        options?.intentId,
      )
      const { intent } = await workflows.signIntent(ctx, internal)
      return toSignedTransactionData(preparedTransaction, intent, signedIntents)
    }) as unknown as ManagedEvmAccount<C>['signTransaction'],
    async assembleTransaction(preparedTransaction, signatures, options) {
      assertPreparedArtifact(preparedTransaction, publicConfig)
      if (isSolanaOrigin(preparedTransaction.transaction)) {
        refuseSolanaAssembly()
      }
      const ctx = context('assemble-intent')
      const workflows = workflowsFor(ctx)
      const intentIds = [...new Set(signatures.map(({ intentId }) => intentId))]
      if (intentIds.length > 1) {
        throw new MismatchedOwnerSignaturesError({ context: { intentIds } })
      }
      const internal = await resolvePrepared(
        ctx,
        preparedTransaction,
        intentIds[0],
      )
      const signed = await workflows.assembleIntent(
        ctx,
        internal,
        signatures as unknown as Parameters<typeof workflows.assembleIntent>[2],
        options?.proofs ? { proofs: options.proofs } : undefined,
      )
      return toSignedTransactionData(preparedTransaction, signed, signedIntents)
    },
    async signAuthorizations(preparedTransaction, options) {
      assertPreparedArtifact(preparedTransaction, publicConfig)
      if (isSolanaOrigin(preparedTransaction.transaction)) {
        throw new UnsupportedAccountCapabilityError(
          'EIP-7702 authorizations are unavailable for Solana-origin transactions.',
          { vm: 'solana' },
        )
      }
      const ctx = context('sign-authorizations')
      const internal = await resolvePrepared(
        ctx,
        preparedTransaction,
        options?.intentId,
      )
      return workflowsFor(ctx).signRequestedDelegations(ctx, internal)
    },
    async signMessage(message, chain, signers) {
      const ctx = context('sign-message')
      const result = await workflowsFor(ctx).signMessage(ctx, {
        message,
        chain: toEvmChainReference(chain.id),
        ...(signers
          ? { signers: adaptSignerSelection(ctx.account, signers) }
          : {}),
      })
      return result.signature
    },
    async signTypedData(parameters, chain, signers) {
      const ctx = context('sign-typed-data')
      const result = await workflowsFor(ctx).signTypedData(ctx, {
        typedData: parameters as unknown as TypedDataDefinition,
        chain: toEvmChainReference(chain.id),
        ...(signers
          ? { signers: adaptSignerSelection(ctx.account, signers) }
          : {}),
      })
      return result.signature
    },
    async signIntent(signingRequests, targetChain, signers) {
      const ctx = context('sign-intent')
      const result = await workflowsFor(ctx).signIntentFromRequests(ctx, {
        signingRequests,
        targetChain: destinationChainReference(targetChain),
        ...(signers
          ? { signers: adaptSignerSelection(ctx.account, signers) }
          : {}),
      })
      return { proofs: [...result.proofs] }
    },
    async submitTransaction(signedTransaction, options) {
      assertPreparedArtifact(signedTransaction, publicConfig)
      const ctx = context('submit-intent')
      const workflows = workflowsFor(ctx)
      if (isSolanaOrigin(signedTransaction.transaction)) {
        return requireSolana().submit(
          ctx.sdk,
          workflows,
          signedTransaction,
          options,
        )
      }
      // Fast path for the same-instance signed object; otherwise (cross-instance
      // replay or caller-tampered proofs) rebuild from the public shape.
      const cached = signedIntents.get(signedTransaction)
      const base: SignedIntent<Compat> = cached ?? {
        prepared: await resolvePrepared(
          ctx,
          signedTransaction,
          signedTransaction.quote.intentId,
        ),
        proofs: signedTransaction.proofs,
        transcript: { planKind: 'intent-full', payloadId: '0x', stages: [] },
      }
      const signed: SignedIntent<Compat> = {
        ...base,
        ...(options?.internal_dryRun ? { dryRun: true } : {}),
      }
      const submitted = await workflows.submitIntent(ctx, signed)
      return {
        type: 'intent',
        id: submitted.intentId,
        traceId: submitted.traceId,
        ...(submitted.sourceChains
          ? { sourceChains: [...submitted.sourceChains] }
          : {}),
        targetChain: submitted.targetChain,
      }
    },
    async prepareUserOperation(transaction) {
      const ctx = context('prepare-user-operation')
      const signers = userOperationSignerSelection(ctx, transaction)
      const prepared = await workflowsFor(ctx).prepareUserOperation(ctx, {
        chain: toEvmChainReference(transaction.chain.id),
        calls: transaction.calls.map((call) =>
          adaptCall(call, transaction.chain.id),
        ),
        ...(transaction.gasLimit === undefined
          ? {}
          : { gasLimit: transaction.gasLimit }),
        ...(signers ? { signers } : {}),
      })
      const data: PreparedUserOperationData = {
        userOperation:
          prepared.operation as unknown as PreparedUserOperationData['userOperation'],
        hash: prepared.hash,
        transaction,
      }
      return data
    },
    async signUserOperation(preparedUserOperation) {
      const ctx = context('sign-user-operation')
      const signers = userOperationSignerSelection(
        ctx,
        preparedUserOperation.transaction,
      )
      // Recompute from the current public operation and live owners.
      const internal = await workflowsFor(ctx).reconstructPreparedUserOperation(
        ctx,
        {
          chain: toEvmChainReference(
            preparedUserOperation.transaction.chain.id,
          ),
          operation:
            preparedUserOperation.userOperation as unknown as PreparedUserOperation<Compat>['operation'],
          ...(signers ? { signers } : {}),
        },
      )
      const signed = await workflowsFor(ctx).signUserOperation(ctx, internal)
      const data: SignedUserOperationData = {
        ...preparedUserOperation,
        signature: signed.signature,
      }
      return data
    },
    async submitUserOperation(signedUserOperation) {
      const ctx = context('submit-user-operation')
      const signers = userOperationSignerSelection(
        ctx,
        signedUserOperation.transaction,
      )
      // The public operation and top-level signature remain authoritative.
      const internal = await workflowsFor(ctx).reconstructSignedUserOperation(
        ctx,
        {
          chain: toEvmChainReference(signedUserOperation.transaction.chain.id),
          operation:
            signedUserOperation.userOperation as unknown as PreparedUserOperation<Compat>['operation'],
          signature: signedUserOperation.signature,
          ...(signers ? { signers } : {}),
        },
      )
      const submitted = await workflowsFor(ctx).submitUserOperation(
        ctx,
        internal,
      )
      return {
        type: 'userop',
        hash: submitted.hash,
        chain: submitted.chain.id,
      }
    },
    async sendUserOperation(transaction) {
      const ctx = context('send-user-operation')
      const signers = userOperationSignerSelection(ctx, transaction)
      const submitted = await workflowsFor(ctx).sendUserOperation(ctx, {
        chain: toEvmChainReference(transaction.chain.id),
        calls: transaction.calls.map((call) =>
          adaptCall(call, transaction.chain.id),
        ),
        ...(transaction.gasLimit === undefined
          ? {}
          : { gasLimit: transaction.gasLimit }),
        ...(signers ? { signers } : {}),
      })
      return {
        type: 'userop',
        hash: submitted.hash,
        chain: submitted.chain.id,
      }
    },
    waitForExecution: ((
      result: TransactionResult | UserOperationResult,
    ): Promise<TransactionStatus | UserOperationReceipt> => {
      if (result.type === 'intent') {
        const ctx = context('wait-for-execution')
        return workflowsFor(ctx)
          .waitForIntentStatus(ctx, result.id)
          .then(toPublicTransactionStatus)
      }
      const ctx = context('wait-for-execution')
      return workflowsFor(ctx)
        .waitForUserOperationStatus(ctx, {
          type: 'userop',
          chain: toEvmChainReference(result.chain),
          hash: result.hash,
        })
        .then((status) => status.receipt as UserOperationReceipt)
    }) as unknown as ManagedEvmAccount<C>['waitForExecution'],
    getAddress: ((vm: AccountVm): Address | SolanaAddress => {
      if (vm === 'solana') {
        if (
          publicConfig.solana &&
          'address' in publicConfig.solana &&
          publicConfig.solana.address
        ) {
          return publicConfig.solana.address
        }
        if (solana) return solana.walletAddress
        throw new AccountVmNotConfiguredError('solana')
      }
      if (vm !== 'evm' || !publicConfig.evm) {
        throw new AccountVmNotConfiguredError(String(vm))
      }
      const ctx = context('get-address')
      return workflowsFor(ctx).getAddress(ctx, referenceChain())
    }) as ManagedEvmAccount<C>['getAddress'],
    getPortfolio(onTestnets = false) {
      const ctx = context('get-portfolio')
      return workflowsFor(ctx)
        .getPortfolio(ctx, onTestnets)
        .then((portfolio) => portfolio.tokens as unknown as Portfolio)
    },
    getSessionDetails(sessions) {
      const ctx = context('get-session-details')
      return workflowsFor(ctx).getSessionDetails(ctx, sessions)
    },
    isSessionEnabled(session) {
      const ctx = context('is-session-enabled')
      return workflowsFor(ctx).isSessionEnabled(ctx, session)
    },
    signEnableSession(details) {
      const ctx = context('sign-enable-session')
      return workflowsFor(ctx).signEnableSession(ctx, details)
    },
    getOwners(chain) {
      const ctx = context('get-owners')
      return workflowsFor(ctx)
        .getOwners(ctx, toEvmChainReference(chain.id))
        .then((owners) =>
          owners
            ? { accounts: [...owners.accounts], threshold: owners.threshold }
            : null,
        )
    },
    getValidators(chain) {
      const ctx = context('get-validators')
      return workflowsFor(ctx)
        .getValidators(ctx, toEvmChainReference(chain.id))
        .then((addresses) => [...addresses])
    },
    getExecutors(chain) {
      const ctx = context('get-executors')
      return workflowsFor(ctx)
        .getExecutors(ctx, toEvmChainReference(chain.id))
        .then((addresses) => [...addresses])
    },
  }
  return account
}

/**
 * The orchestrator each environment serves managed Solana from. Any other
 * environment/endpoint pair has no matching Swig namespace behind it.
 */
const MANAGED_SOLANA_ENDPOINTS = {
  development: 'https://dev.v1.orchestrator.rhinestone.dev',
  production: 'https://v1.orchestrator.rhinestone.dev',
} as const satisfies Record<ResolvedSdkConfig['environment'], string>

export function isManagedSolanaEndpoint(
  environment: ResolvedSdkConfig['environment'],
  orchestratorUrl: string,
): boolean {
  return (
    Object.hasOwn(MANAGED_SOLANA_ENDPOINTS, environment) &&
    orchestratorUrl.replace(/\/+$/u, '') ===
      MANAGED_SOLANA_ENDPOINTS[environment]
  )
}

/** The explicitly selected Swig and optional local EVM composition. */
export interface SolanaSource {
  readonly owner: SolanaOwner
  readonly walletAddress: SolanaAddress
  readonly swigAddress: SolanaAddress
  /** The environment the account was created in. */
  readonly environment: ResolvedSdkConfig['environment']
  /** The orchestrator the account was created against. */
  readonly endpoint: string
  /** Address used only as the default recipient for plain EVM delivery. */
  readonly evmRecipient?: Address
  /** Managed EVM account available to execute destination calls. */
  readonly evmExecution?: {
    readonly address: Address
    readonly accountType: 'GENERIC' | 'ERC7579' | 'EOA'
  }
}

function refuseSolanaAssembly(): never {
  throw new IndependentSigningNotSupportedError({ context: { vm: 'solana' } })
}

function assertSolanaMetadata(
  actual: PreparedTransactionData['execution'],
  expected: SolanaTransferInput,
): void {
  const expectedEntries = Object.entries(solanaMetadata(expected))
  if (
    !actual ||
    Object.keys(actual).length !== expectedEntries.length ||
    expectedEntries.some(
      ([key, value]) =>
        (actual as unknown as Record<string, unknown>)[key] !== value,
    )
  ) {
    throw new InvalidSolanaTransactionArtifactError(
      'the execution binding does not match this account, environment, chain, recipient, or mint',
    )
  }
}

function createSolanaOrigin(
  source: SolanaSource,
  publicConfig: Readonly<RhinestoneAccountConfig>,
) {
  const namespace = MANAGED_SWIG_NAMESPACES[source.environment]
  const assertDestinationCallsSupported = (): void => {
    if (!source.evmExecution) {
      throw new UnsupportedAccountCapabilityError(
        'EVM destination calls require a managed EVM account; an address-only receiver can only receive a plain delivery. Omit `calls`.',
        { vm: 'solana', field: 'calls' },
      )
    }
    const compatible = locateSwig(
      asSwigNamespace(namespace),
      source.evmExecution.address,
    )
    if (
      compatible.wallet !== source.walletAddress ||
      compatible.swig !== source.swigAddress
    ) {
      throw new UnsupportedAccountCapabilityError(
        'This backend cannot execute EVM destination calls from the independently selected Swig. Omit `calls` to make a plain delivery.',
        { vm: 'solana', field: 'calls' },
      )
    }
  }

  const authority: SwigAuthority =
    source.owner.type === 'passkey'
      ? {
          kind: 'secp256r1',
          publicKey: compressP256PublicKey(source.owner.account.publicKey),
        }
      : { kind: 'secp256k1', address: source.owner.account.address }

  const transfer = (
    sdk: ResolvedSdkConfig,
    candidate: Transaction,
    execution?: SolanaEvmExecution,
  ): SolanaTransferInput => {
    const transaction = normalizeTransaction(candidate, publicConfig)
    assertCapturedEnvironment(sdk)
    if (!isSolanaOrigin(transaction)) {
      throw new InvalidSolanaTransactionArtifactError(
        'the transaction is not a Solana-origin transfer',
      )
    }
    if (execution) assertDestinationCallsSupported()
    if (isSolanaAuthorityChange(transaction)) {
      // Always sponsored and fee-free, and never through a paired EVM account:
      // the change is to this Swig alone.
      const { action, key, permission } = transaction.destination.authority
      return {
        chain: transaction.destination.chain,
        accountAddress: source.walletAddress,
        authority,
        walletAddress: source.walletAddress,
        swigAddress: source.swigAddress,
        namespace,
        endpoint: sdk.orchestratorUrl,
        sponsorSettings: { ...SOLANA_AUTHORITY_SPONSORSHIP },
        action: {
          kind: 'authority',
          change: {
            action,
            keyType: key.type,
            key: key.publicKey,
            ...(action === 'add' ? { permission } : {}),
          },
        },
      }
    }
    const fees = transaction as {
      appFees?: SolanaTransferInput['appFees']
      protocolFees?: SolanaTransferInput['protocolFees']
    }
    const common = {
      ...(execution && source.evmExecution
        ? {
            accountAddress: source.evmExecution.address,
            accountType: source.evmExecution.accountType,
          }
        : { accountAddress: source.walletAddress }),
      authority,
      walletAddress: source.walletAddress,
      swigAddress: source.swigAddress,
      namespace,
      endpoint: sdk.orchestratorUrl,
      ...(fees.appFees ? { appFees: fees.appFees } : {}),
      ...(fees.protocolFees ? { protocolFees: fees.protocolFees } : {}),
      ...(() => {
        const sponsorSettings = toSponsorSettings(transaction.sponsored)
        return sponsorSettings ? { sponsorSettings } : {}
      })(),
    } satisfies Partial<SolanaTransferInput>
    if (isCrossChainSolanaOrigin(transaction)) {
      const { destination } = transaction
      // Resolved here rather than in `normalizeTransaction` so the prepare and
      // reconstruct paths agree on the same recipient.
      const recipient = destination.recipient ?? source.evmRecipient
      if (!recipient) {
        throw new UnsupportedAccountCapabilityError(
          'A Solana-origin delivery from an account with no EVM entry needs an explicit EVM `destination.recipient`.',
          { vm: 'solana', field: 'destination.recipient' },
        )
      }
      return {
        ...common,
        chain: transaction.source.chain,
        action: {
          kind: 'transfer',
          mint: transaction.source.token,
          ...(destination.amount === undefined
            ? {}
            : { amount: destination.amount }),
          ...(transaction.source.maxAmount === undefined
            ? {}
            : { sourceLimit: transaction.source.maxAmount }),
          delivery: {
            kind: 'cross-chain',
            chainId: destination.chain.id,
            token: destination.token,
            recipient,
            ...(execution ? { execution } : {}),
          },
        },
      }
    }
    if (isSolanaInstructionExecution(transaction)) {
      const { destination } = transaction
      return {
        ...common,
        chain: destination.chain,
        action: {
          kind: 'instructions',
          instructions: normalizeSolanaInstructions(destination.instructions),
          ...(destination.addressLookupTables
            ? { addressLookupTables: destination.addressLookupTables }
            : {}),
          ...(transaction.source ? { feeToken: transaction.source.token } : {}),
        },
      }
    }
    const { destination, source: spend } =
      transaction as SameChainSolanaTransaction
    return {
      ...common,
      chain: destination.chain,
      action: {
        kind: 'transfer',
        mint: destination.token,
        ...(destination.amount === undefined
          ? {}
          : { amount: destination.amount }),
        ...(spend.maxAmount === undefined
          ? {}
          : { sourceLimit: spend.maxAmount }),
        delivery: { kind: 'same-chain', recipient: destination.recipient },
      },
    }
  }

  const resolve = (
    sdk: ResolvedSdkConfig,
    workflows: SolanaWorkflows,
    prepared: PreparedTransactionData,
    intentId?: string,
    explicitQuote?: Quote,
  ) => {
    assertPreparedBinding(prepared.request)
    const transaction = normalizeTransaction(prepared.transaction, publicConfig)
    const destinationCalls = isCrossChainSolanaOrigin(transaction)
      ? transaction.destination.calls
      : undefined
    // Read back from the canonical input rather than resolved again: resolving
    // reads the chain and runs caller code, and a replay has to rebuild the
    // request that was quoted.
    if (destinationCalls?.length) assertDestinationCallsSupported()
    const stored = prepared.intentInput
    const storedExecution =
      stored.destination.vm === 'evm' ? stored.destination.execution : undefined
    const evm = stored.account.evm
    const execution: SolanaEvmExecution | undefined =
      destinationCalls?.length && storedExecution && evm
        ? {
            calls: storedExecution.calls.map(({ to, value, data }) => ({
              target: to,
              value: BigInt(value),
              data,
            })),
            ...(storedExecution.gasLimit === undefined
              ? {}
              : { gasLimit: BigInt(storedExecution.gasLimit) }),
            account: {
              kind: evm.type,
              address: evm.address,
              setupOps:
                evm.type === 'erc7579' ? (evm.initData?.setupOps ?? []) : [],
              ...(evm.delegations?.default
                ? { delegationContract: evm.delegations.default.contract }
                : {}),
            },
          }
        : undefined
    const input = transfer(sdk, transaction, execution)
    assertSolanaMetadata(prepared.execution, input)
    const quote = explicitQuote ?? selectedPublicQuote(prepared, intentId)
    return workflows.reconstructSolanaIntent({
      traceId: prepared.quotes.traceId,
      transfer: input,
      request: restorePreparedBinding(prepared.request),
      intentInput: prepared.intentInput,
      quote: normalizeIntentQuote(quote as OrchestratorExecutionQuote),
      quotes: prepared.quotes.all.map((candidate) =>
        normalizeIntentQuote(candidate as OrchestratorExecutionQuote),
      ),
    })
  }

  const assertCapturedEnvironment = (sdk: ResolvedSdkConfig): void => {
    if (
      sdk.environment !== source.environment ||
      sdk.orchestratorUrl !== source.endpoint ||
      !isManagedSolanaEndpoint(sdk.environment, sdk.orchestratorUrl)
    ) {
      throw new ManagedSolanaAccountNotSupportedError(
        'Managed Solana execution remains bound to the environment and endpoint captured when the account was created.',
      )
    }
  }

  const resolveSwigId = (swigId: unknown): Hex => {
    const refuse = (message: string): never => {
      throw new UnsupportedAccountCapabilityError(message, {
        vm: 'solana',
        field: 'swigId',
        swig: source.swigAddress,
      })
    }
    if (swigId !== undefined) {
      if (typeof swigId !== 'string' || !/^0x[0-9a-fA-F]{64}$/u.test(swigId)) {
        refuse('`swigId` must be the 32-byte Swig id as 0x-prefixed hex.')
      }
      const id = (swigId as string).toLowerCase() as Hex
      if (locateSwigById(hexToBytes(id)).swig !== source.swigAddress) {
        refuse(
          `\`swigId\` does not derive the configured Swig ${source.swigAddress}. Pass the id saved with that Swig.`,
        )
      }
      return id
    }
    if (source.evmExecution) {
      const derived = locateSwig(
        asSwigNamespace(namespace),
        source.evmExecution.address,
      )
      if (derived.swig === source.swigAddress) return bytesToHex(derived.id)
    }
    return refuse(
      `Creating the Swig ${source.swigAddress} needs the id it was minted with. Mint an independent Swig with \`createSolanaSwigId()\`, save its \`id\` with the \`swig\` address, and pass \`{ swigId: id }\` to \`deploy\`.`,
    )
  }

  // The permanent root role, derived from the configured owner and never from
  // caller input.
  const rootAuthority = (): OrchestratorSwigInitData['authority'] => {
    if (authority.kind === 'secp256r1') {
      return { kind: 'secp256r1', publicKey: authority.publicKey }
    }
    const refuse = (message: string): never => {
      throw new UnsupportedAccountCapabilityError(message, {
        vm: 'solana',
        field: 'owner',
      })
    }
    const publicKey = (source.owner.account as { publicKey?: unknown })
      .publicKey
    if (
      typeof publicKey !== 'string' ||
      !/^0x04[0-9a-fA-F]{128}$/u.test(publicKey)
    ) {
      refuse(
        "Creating a Swig installs the ECDSA owner's public key as its root, and this owner account exposes none. Configure the Solana owner with a viem local account (such as `privateKeyToAccount`), which carries `publicKey`.",
      )
    }
    if (
      !isAddressEqual(publicKeyToAddress(publicKey as Hex), authority.address)
    ) {
      refuse("The ECDSA owner's `publicKey` does not belong to its `address`.")
    }
    return { kind: 'secp256k1', publicKey: publicKey as Hex }
  }

  const deploy = async (
    sdk: ResolvedSdkConfig,
    workflows: SolanaWorkflows,
    wait: (intentId: string) => Promise<IntentStatus>,
    chain: SolanaChain,
    options?: SolanaDeployOptions,
  ): Promise<true> => {
    assertCapturedEnvironment(sdk)
    const chainId = solanaChainId(chain)
    const input: SolanaDeploymentInput = {
      chain,
      walletAddress: source.walletAddress,
      swigAddress: source.swigAddress,
      authorization: authority,
      initAuthority: rootAuthority(),
      swigId: resolveSwigId(options?.swigId),
      namespace,
      endpoint: sdk.orchestratorUrl,
    }
    let prepared: PreparedSolanaDeployment
    try {
      prepared = await workflows.prepareSolanaDeployment(input)
    } catch (error) {
      // Idempotent: the Swig existing is the outcome the caller asked for. Its
      // root is not verified; a foreign root only fails the owner's spends.
      if (
        isSolanaAccountAlreadyCreated(error) &&
        error.swigAddress === source.swigAddress &&
        error.chainId === chainId
      ) {
        return true
      }
      throw error
    }
    const submitted = await workflows.submitSolanaDeployment(prepared)
    // Throws on a failed intent, so a resolved wait is a created Swig.
    await wait(submitted.intentId)
    return true
  }

  const authorityStatus = async (
    sdk: ResolvedSdkConfig,
    workflows: SolanaWorkflows,
    transaction: SameChainSolanaAuthorityTransaction,
  ): Promise<SolanaAuthorityStatus> => {
    const change = transaction.destination.authority
    try {
      await workflows.prepareSolanaIntent(transfer(sdk, transaction))
      return { status: 'notApplied' }
    } catch (error) {
      if (
        !isSolanaAuthorityChangeRefused(error) ||
        (error.swigAddress !== undefined &&
          error.swigAddress !== source.swigAddress)
      ) {
        throw error
      }
      if (
        change.action === 'add' &&
        error.reason === 'authority_exists' &&
        error.roleId !== undefined
      ) {
        if (error.permission === change.permission) {
          return { status: 'applied', roleId: error.roleId }
        }
        return {
          status: 'conflict',
          roleId: error.roleId,
          ...(error.permission ? { permission: error.permission } : {}),
        }
      }
      if (
        change.action === 'remove' &&
        error.reason === 'authority_not_found'
      ) {
        return { status: 'applied' }
      }
      throw error
    }
  }

  return {
    walletAddress: source.walletAddress,
    assertDestinationCallsSupported,
    authorityStatus,
    deploy,
    resolve,
    async prepare(
      sdk: ResolvedSdkConfig,
      workflows: SolanaWorkflows,
      transaction: Transaction,
      execution?: SolanaEvmExecution,
    ): Promise<PreparedTransactionData> {
      const prepared = await workflows.prepareSolanaIntent(
        transfer(sdk, transaction, execution),
      )
      return toPreparedSolanaTransactionData(prepared, transaction)
    },
    async sign(
      sdk: ResolvedSdkConfig,
      workflows: SolanaWorkflows,
      preparedTransaction: PreparedTransactionData,
      options?: QuoteSelection | SignAsOwnerOptions,
      signEvmRequests?: Parameters<
        SolanaWorkflows['signSolanaIntent']
      >[0]['signEvmRequests'],
    ): Promise<SignedTransactionData> {
      if (options && 'owner' in options) refuseSolanaAssembly()
      const prepared = resolve(
        sdk,
        workflows,
        preparedTransaction,
        options?.intentId,
      )
      const signed = await workflows.signSolanaIntent({
        prepared,
        owner: source.owner.account,
        ...(signEvmRequests ? { signEvmRequests } : {}),
      })
      return {
        ...preparedTransaction,
        quote: toPublicQuote(signed.prepared.quote),
        proofs: [...signed.proofs],
      }
    },
    async submit(
      sdk: ResolvedSdkConfig,
      workflows: SolanaWorkflows,
      signedTransaction: SignedTransactionData,
      options?: SubmitTransactionOptions,
    ): Promise<TransactionResult> {
      assertPreparedBinding(signedTransaction.request)
      if (options && Object.keys(options).length > 0) {
        throw new UnsupportedAccountCapabilityError(
          'Solana submission does not accept submission options.',
          { vm: 'solana' },
        )
      }
      const [proof, ...evmProofs] = signedTransaction.proofs
      if (
        (proof?.kind !== 'personalSign' && proof?.kind !== 'webauthn') ||
        signedTransaction.proofs.length !==
          signedTransaction.quote.signingRequests.length ||
        evmProofs.some(({ kind }) => kind !== 'eip712' && kind !== 'eip7702')
      ) {
        throw new InvalidSolanaTransactionArtifactError(
          'submission requires the personal-sign or WebAuthn spend proof, then an EIP-712 or EIP-7702 proof for each further signing request',
          { intentId: signedTransaction.quote.intentId },
        )
      }
      const prepared = resolve(
        sdk,
        workflows,
        signedTransaction,
        signedTransaction.quote.intentId,
        signedTransaction.quote,
      )
      const submitted = await workflows.submitSolanaIntent({
        prepared,
        proofs: [proof, ...evmProofs],
      })
      return {
        type: 'intent',
        id: submitted.intentId,
        traceId: submitted.traceId,
        ...(submitted.sourceChains
          ? { sourceChains: [...submitted.sourceChains] }
          : {}),
        targetChain: submitted.targetChain,
      }
    },
  }
}

/**
 * The restricted facade of a managed Solana account without managed EVM
 * capabilities. An optional EVM receiver is used only for address access and
 * plain-delivery defaults.
 */
export function createSolanaAccountFacade<C extends RhinestoneAccountConfig>(
  source: SolanaSource,
  publicConfig: Readonly<C>,
  composition: CoreComposition<Compat>,
): SolanaStandaloneAccount<C> {
  const solana = createSolanaOrigin(source, publicConfig)
  const sdk = composition.config
  const workflows = composition.project.solana
  return {
    config: publicConfig,
    getAddress: ((vm: AccountVm) => {
      if (vm === 'solana') return source.walletAddress
      if (vm === 'evm' && source.evmRecipient) return source.evmRecipient
      throw new AccountVmNotConfiguredError(String(vm))
    }) as RhinestoneAccountBase<C>['getAddress'],
    async prepareTransaction(transaction) {
      const normalized = normalizeTransaction(transaction, publicConfig)
      if (!isSolanaOrigin(normalized)) {
        throw new UnsupportedAccountCapabilityError(
          'An account without a managed EVM entry can only originate on Solana.',
          { vm: 'evm' },
        )
      }
      return solana.prepare(sdk, workflows, normalized)
    },
    getTransactionMessages(preparedTransaction, options) {
      solana.resolve(sdk, workflows, preparedTransaction, options?.intentId)
      return [
        ...selectedPublicQuote(preparedTransaction, options?.intentId)
          .signingRequests,
      ]
    },
    signTransaction: (preparedTransaction, options) =>
      solana.sign(sdk, workflows, preparedTransaction, options),
    // Untyped callers passing options are refused rather than ignored.
    submitTransaction: (
      signedTransaction,
      options?: SubmitTransactionOptions,
    ) => solana.submit(sdk, workflows, signedTransaction, options),
    waitForExecution: (result) =>
      composition.project
        .waitForIntentStatus(result.id)
        .then(toPublicTransactionStatus),
    getAuthorityStatus: async (transaction) =>
      solana.authorityStatus(
        sdk,
        workflows,
        normalizeAuthorityChange(transaction, publicConfig),
      ),
    deploy: async (vm, chain, options) => {
      if (vm !== 'solana') {
        throw new UnsupportedAccountCapabilityError(
          'An account without a managed EVM entry can only create its Swig.',
          { vm: String(vm) },
        )
      }
      return solana.deploy(
        sdk,
        workflows,
        composition.project.waitForIntentStatus,
        chain,
        options,
      )
    },
  }
}

function signerIdForOwner(owner: SignAsOwnerOptions['owner']): string {
  // ECDSA local accounts also expose `publicKey`, so discriminate on the
  // account type rather than the presence of a public key.
  if ((owner as { type?: string }).type === 'webAuthn') {
    return webauthnSignerId((owner as { publicKey: Hex }).publicKey)
  }
  return ecdsaSignerId((owner as { address: Address }).address)
}

function userOperationSignerSelection(
  context: AccountInvocationContext<Compat>,
  transaction: UserOperationTransaction,
): OwnerSignerSelection | undefined {
  if (!transaction.signers) return undefined
  if (transaction.signers?.type === 'session') {
    throw new Error('No account found')
  }
  const selection = adaptUserOperationSignerSelection(
    context.account,
    transaction.signers,
  )
  if (selection.kind !== 'owner') throw new Error('No account found')
  return selection
}

function destinationChainReference(
  targetChain: DestinationChain,
): import('../chains/types').ChainReference {
  if ('kind' in targetChain && typeof targetChain.caip2 === 'string') {
    return parseCaip2(targetChain.caip2)
  }
  return getChainReference((targetChain as { id: number }).id)
}

// Public `Transaction` -> internal `IntentInput`. Owned here because the facade
// is the only translation point between the compatibility surface and the
// intent workflow.
/**
 * Derives the quoter pin a venue-scoped session implies.
 *
 * A session created with `swap: { via: [...] }` already names the venues it will
 * authorise on-chain, but the orchestrator picks the venue *after* the session is
 * signed. Sending the matching pin closes that gap, and deriving it here means a
 * caller states the venue once — stating it twice and keeping the two in sync by
 * hand is the drift this is meant to prevent.
 *
 * Returns undefined (no pin) when the scope cannot imply one: a bare Rhinestone
 * Swapper venue is aggregator-agnostic, so any quoter may legitimately fill it,
 * and pinning would reject routes the session actually permits.
 *
 * Across a per-chain session set the pin is the INTERSECTION, not the union.
 * `options.quoters` is one global filter with no chain dimension, so a venue is
 * only safe to allow if every session would accept it — unioning a 0x-only and
 * a fynd-only session would permit fynd everywhere and be rejected on-chain by
 * the first. An empty intersection means no single venue satisfies every
 * session, which is unservable rather than unconstrained — it yields an empty
 * filter so the request fails at quote time, instead of no filter, which would
 * hand the orchestrator back the free choice the pin exists to take away.
 */
function venuesForSession(
  session:
    | { swap?: { via?: readonly { id: string; route?: string }[] } }
    | undefined,
): Set<SwapQuoter> | null {
  const via = session?.swap?.via
  // No venue list means the scope defaults to the Swapper — unconstrained.
  if (!via?.length) return null
  const quoters = new Set<SwapQuoter>()
  for (const venue of via) {
    if (venue.id === '0x') quoters.add('0x')
    else if (venue.id === 'fynd') quoters.add('fynd')
    else if (venue.id === 'rhinestone') {
      // The Swapper routes through whichever aggregator wins unless the scope
      // pinned one, so an unpinned Swapper venue admits any quoter.
      if (venue.route === 'zeroEx') quoters.add('0x')
      else if (venue.route === 'fynd') quoters.add('fynd')
      else return null
    } else return null
  }
  return quoters
}

function quoterPinFromSession(
  signers: SignerSet | undefined,
  /**
   * Chains this intent can actually touch. A per-chain session map is reusable
   * and may carry chains the intent never signs on; `prepareIntentSessions`
   * selects only the intent's own chains, so intersecting the rest would let an
   * unrelated entry veto a venue and fail the quote for nothing.
   */
  chainIds: readonly number[],
): SwapQuoterFilter | undefined {
  if (signers?.type !== 'session') return undefined
  const relevant = new Set(chainIds)
  const sessions =
    'session' in signers
      ? [signers.session]
      : Object.entries(signers.sessions ?? {})
          .filter(([chainId]) => relevant.has(Number(chainId)))
          .map(([, s]) => s.session)

  let pinned: Set<SwapQuoter> | null = null
  for (const session of sessions) {
    const venues = venuesForSession(session)
    // An unconstrained session admits every venue, so it narrows nothing.
    if (!venues) continue
    if (!pinned) {
      pinned = venues
      continue
    }
    const narrowed = new Set<SwapQuoter>()
    for (const quoter of pinned) {
      if (venues.has(quoter)) narrowed.add(quoter)
    }
    pinned = narrowed
  }
  // Null means nothing constrained anything — genuinely unpinned. An empty set
  // is the opposite: the sessions conflict, so no venue is safe and the empty
  // filter fails the request closed.
  if (!pinned) return undefined
  return { include: [...pinned] }
}

/**
 * Combine an explicit `quoters` filter with the one a venue-scoped session
 * implies.
 *
 * An explicit filter cannot WIDEN the session: the venues it names are what the
 * on-chain policy will accept, so allowing a caller to replace the derived pin
 * would route outside them and be rejected at execution — or, where the scope
 * left the tail open, spend inside a venue the session was never meant to
 * authorise. With no session scope there is nothing to narrow against and the
 * explicit filter stands on its own.
 */
function narrowQuoterPin(
  derived: SwapQuoterFilter | undefined,
  explicit: SwapQuoterFilter | undefined,
): SwapQuoterFilter | undefined {
  if (!explicit) return derived
  if (!derived || !('include' in derived)) return explicit
  const allowed = new Set(derived.include)
  const narrowed =
    'include' in explicit
      ? explicit.include.filter((quoter) => allowed.has(quoter))
      : derived.include.filter((quoter) => !explicit.exclude.includes(quoter))
  return { include: narrowed }
}

/**
 * Translates the public `sponsored` input into the wire's `sponsorSettings`.
 * Shared by both VMs so the two cannot drift.
 */
function toSponsorSettings(
  sponsored: Sponsorship | undefined,
): NonNullable<IntentInput['options']>['sponsorSettings'] {
  if (!sponsored) return undefined
  if (typeof sponsored === 'boolean') {
    return {
      gas: sponsored,
      bridgeFees: sponsored,
      swapFees: sponsored,
      protocolFees: sponsored,
    }
  }
  return {
    gas: sponsored.gas,
    bridgeFees: sponsored.bridging,
    swapFees: sponsored.swaps,
    protocolFees: sponsored.protocolFees ?? false,
  }
}

export function adaptTransaction(
  context: AccountInvocationContext<Compat>,
  transaction: Transaction,
  hyperCoreAction?: HyperCoreAction,
): IntentInput {
  if (isSolanaOrigin(transaction)) {
    throw new UnsupportedAccountCapabilityError(
      'Solana-origin transactions run through the managed Solana account.',
      { vm: 'solana' },
    )
  }
  const { source, destination: target } = transaction as EvmOriginTransaction
  const destination =
    'kind' in target.chain
      ? parseCaip2(target.chain.caip2)
      : getChainReference(target.chain.id)
  const destinationChainId =
    destination.kind === 'evm' ? destination.id : undefined
  const sourceChain = source?.chain
    ? toEvmChainReference((source.chain as Chain).id)
    : undefined
  const evmTarget = target as {
    calls?: CallInput[]
    gasLimit?: bigint
    recipient?: EvmAccountConfig | string
    token?: string
    amount?: bigint
  }
  return {
    destination,
    ...(source && sourceChain
      ? {
          source: {
            chain: sourceChain,
            token: source.token,
            ...(source.maxAmount === undefined
              ? {}
              : { maxAmount: source.maxAmount }),
            ...(source.auxiliaryFunds === undefined
              ? {}
              : { auxiliaryFunds: source.auxiliaryFunds }),
            ...(source.calls
              ? {
                  calls: source.calls.map((call) => ({
                    call: adaptCall(call, sourceChain.id),
                    ...(call.provides ? { provides: call.provides } : {}),
                  })),
                }
              : {}),
          },
        }
      : {}),
    calls: (evmTarget.calls ?? []).map((call) =>
      adaptCall(call, destinationChainId),
    ),
    ...(evmTarget.token === undefined
      ? {}
      : {
          token:
            destinationChainId === undefined
              ? evmTarget.token
              : normalizeTokenAddress(
                  evmTarget.token,
                  destinationChainId,
                  false,
                ),
        }),
    ...(evmTarget.amount === undefined ? {} : { amount: evmTarget.amount }),
    ...(evmTarget.recipient
      ? {
          recipient: adaptRecipient(
            context,
            evmTarget.recipient,
            destination,
            transaction.eip7702InitSignature,
            transaction.experimental_accountOverride?.setupOps,
          ),
        }
      : {}),
    ...(evmTarget.gasLimit === undefined
      ? {}
      : { gasLimit: evmTarget.gasLimit }),
    ...(transaction.eip7702InitSignature
      ? { eip7702InitSignature: transaction.eip7702InitSignature }
      : {}),
    options: {
      ...(transaction.appFees ? { appFees: transaction.appFees } : {}),
      ...(transaction.protocolFees
        ? { protocolFees: transaction.protocolFees }
        : {}),
      ...((transaction as EvmTransaction).customDeadline === undefined
        ? {}
        : { customDeadline: (transaction as EvmTransaction).customDeadline }),
      ...(() => {
        const sponsorSettings = toSponsorSettings(transaction.sponsored)
        return sponsorSettings ? { sponsorSettings } : {}
      })(),
      ...(transaction.settlementLayers
        ? { settlementLayers: transaction.settlementLayers }
        : {}),
      ...(() => {
        const derived = quoterPinFromSession(transaction.signers, [
          ...(destinationChainId === undefined ? [] : [destinationChainId]),
          ...(sourceChain ? [sourceChain.id] : []),
        ])
        const quoters = narrowQuoterPin(derived, transaction.quoters)
        return quoters ? { quoters } : {}
      })(),
      ...(hyperCoreAction ? { hyperCore: { action: hyperCoreAction } } : {}),
    },
    ...(transaction.experimental_accountOverride?.setupOps
      ? {
          accountSetupOverride:
            transaction.experimental_accountOverride.setupOps,
        }
      : {}),
    ...(transaction.signers
      ? {
          signers:
            transaction.signers.type === 'session'
              ? {
                  kind: 'smart-session',
                  byChain: adaptSessionSelection(transaction.signers, [
                    ...(sourceChain ? [sourceChain.id] : []),
                    ...(destinationChainId === undefined
                      ? []
                      : [destinationChainId]),
                  ]),
                }
              : adaptSignerSelection(context.account, transaction.signers),
        }
      : {}),
  }
}

function adaptRecipient(
  context: AccountInvocationContext<Compat>,
  recipient: EvmAccountConfig | string,
  destination: IntentInput['destination'],
  eip7702InitSignature: Hex | undefined,
  setupOverride:
    | readonly { readonly to: Address; readonly data: Hex }[]
    | undefined,
): NonNullable<IntentInput['recipient']> {
  if (typeof recipient === 'string') {
    return projectIntentRecipient(recipient)
  }
  if (destination.kind !== 'evm') {
    throw new Error('Smart-account recipients require an EVM destination')
  }
  const resolved = resolveAccountConfig(
    context.sdk,
    toAccountConstructionInput(recipient),
  )
  return asIntentRecipient(
    projectIntentAccount({
      runtime: createStaticAccountRuntime(resolved, destination, false),
      ...(setupOverride ? { setupOverride } : {}),
      ...(eip7702InitSignature ? { eip7702InitSignature } : {}),
    }),
  )
}

function toAccountConstructionInput(
  config: EvmAccountConfig,
): AccountConstructionInput {
  return {
    ...(config.account ? { account: config.account } : {}),
    ...(config.owners ? { owners: config.owners } : {}),
    ...(config.sessions ? { sessions: config.sessions } : {}),
    ...(config.recovery ? { recovery: config.recovery } : {}),
    ...(config.eoa ? { eoa: config.eoa } : {}),
    ...(config.modules ? { modules: config.modules } : {}),
    ...(config.initData ? { initData: config.initData } : {}),
  }
}

function adaptCall(call: CallInput, chainId: number | undefined) {
  if ('resolve' in call) {
    return {
      resolve: async (ctx: {
        config: unknown
        chain: { id: number }
        account: Address
      }) => {
        const chain = getChainById(ctx.chain.id)
        const value = await call.resolve({
          config: ctx.config as never,
          chain,
          accountAddress: ctx.account,
        })
        return (Array.isArray(value) ? value : [value]).map((item) =>
          normalizeCall(item, ctx.chain.id),
        )
      },
    }
  }
  if (chainId === undefined) {
    throw new Error('Destination calls are not supported for non-EVM chains')
  }
  return normalizeCall(call, chainId)
}

function normalizeCall(
  call: Exclude<CallInput, { resolve: unknown }>,
  chainId: number,
) {
  return {
    target: normalizeTokenAddress(call.to, chainId, false) as Address,
    value: call.value ?? 0n,
    data: call.data ?? '0x',
  }
}

function adaptSessionSelection(
  signers: Extract<SignerSet, { type: 'session' }>,
  chainIds: readonly number[],
) {
  if ('sessions' in signers) {
    return Object.fromEntries(
      Object.entries(signers.sessions).map(([chainId, selection]) => [
        Number(chainId),
        selection,
      ]),
    )
  }
  return Object.fromEntries(
    [...new Set(chainIds)].map((chainId) => [
      chainId,
      {
        session: signers.session,
        ...(signers.enableData ? { enableData: signers.enableData } : {}),
      },
    ]),
  )
}
