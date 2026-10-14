import type {
  AppFeeBalances,
  SplitIntentsInput,
  SplitIntentsResult,
} from '../clients/orchestrator/public'
import type {
  RhinestoneAccountConfig,
  RhinestoneSDKConfig,
} from '../config/account'
import type { SdkConstructionInput } from '../config/input'
import type { SessionValidation } from '../modules/validators/smart-sessions/refusals'
import type {
  Session,
  SessionDefinition,
} from '../modules/validators/smart-sessions/types'
import type {
  IntentStatusOptions,
  TransactionStatus,
} from '../transactions/intents/types'
import type { RhinestoneAccount } from './account'
import { attachAccount, composeSdk, type SdkComposition } from './accounts'
import {
  toOrchestratorSplitRequest,
  toPublicSplitResult,
  toPublicTransactionStatus,
} from './project-mappers'

/**
 * Stateful entry point that holds shared configuration (auth, provider,
 * bundler, paymaster) and creates accounts from it, delegating all work to the
 * SDK-core composition.
 *
 * The constructor example requires `apiKey`, your integrator's API key loaded
 * securely from your environment. Prefer the explicit `auth` configuration.
 */
class RhinestoneSDK {
  readonly #sdk: SdkComposition
  // Retained shared-config slots. The composition owns the resolved values;
  // these mirror the published field surface and let the instance answer
  // config questions without re-reaching into the composition internals.
  private authProvider
  private endpointUrl
  private provider
  private bundler
  private paymaster
  private useDevContracts
  private headers
  private hyperliquid

  /**
   * Create an authenticated Rhinestone SDK instance.
   *
   * `apiKey` is your integrator's API key, loaded securely from your environment.
   * @param options Shared configuration applied to every account created by this instance
   * @example
   * ```ts
   * import { RhinestoneSDK } from '@rhinestone/sdk'
   *
   * const sdk = new RhinestoneSDK({
   *   auth: { mode: 'apiKey', apiKey },
   * })
   * ```
   */
  constructor(options: RhinestoneSDKConfig) {
    const input = options as unknown as SdkConstructionInput
    this.provider = input.provider
    this.bundler = input.bundler
    this.paymaster = input.paymaster
    this.endpointUrl = input.endpointUrl
    this.useDevContracts = input.useDevContracts
    this.headers = input.headers
    this.hyperliquid = input.hyperliquid
    this.#sdk = composeSdk(input)
    this.authProvider = this.#sdk.snapshot.authProvider
  }

  /**
   * Create an account using this instance's shared configuration.
   *
   * `owner` is a configured viem signing account; `apiKey` is your integrator's
   * API key. Account creation derives a handle; it does not deploy it onchain.
   * @param config Per-account configuration (owners, account type, modules, sessions)
   * @returns The account instance
   * @example
   * ```ts
   * import { RhinestoneSDK } from '@rhinestone/sdk'
   *
   * const sdk = new RhinestoneSDK({
   *   auth: { mode: 'apiKey', apiKey },
   * })
   *
   * const account = await sdk.createAccount({
   *   evm: { owners: { type: 'ecdsa', accounts: [owner] } },
   * })
   * ```
   */
  async createAccount<const C extends RhinestoneAccountConfig>(
    config: C,
  ): Promise<RhinestoneAccount<C>> {
    return attachAccount(this.#sdk, config)
  }

  /**
   * Get the current status of a submitted intent.
   * @param intentId The intent ID returned when the transaction was submitted
   * @param options Pass `{ full: true }` to also get the recorded `details`
   * block. Polling stays lean without it.
   * @returns The intent status
   */
  getIntentStatus(
    intentId: string,
    options?: IntentStatusOptions,
  ): Promise<TransactionStatus> {
    return this.#sdk.composition.project
      .getIntentStatus(intentId, options)
      .then(toPublicTransactionStatus)
  }

  /**
   * Split a transaction into multiple intents across chains.
   * @param input The intents to split
   * @returns The split-intents result
   */
  splitIntents(input: SplitIntentsInput): Promise<SplitIntentsResult> {
    return this.#sdk.composition.project
      .splitIntents(toOrchestratorSplitRequest(input))
      .then(toPublicSplitResult)
  }

  /**
   * Get the integrator's accrued app-fee balance, as USD totals.
   *
   * App fees are earned by the integrator identified by this instance's API key
   * (project-scoped, not tied to any account) and valued in USD at the moment
   * each fee is collected, so the balance is not affected by later price
   * movements of the collected tokens.
   * @returns The withdrawable and pending app-fee balances in USD
   */
  getAppFeeBalances(): Promise<AppFeeBalances> {
    return this.#sdk.composition.project.getAppFeeBalances() as Promise<AppFeeBalances>
  }

  /**
   * Create a smart session, resolving the chain's wrapped-native token from the
   * orchestrator's chain catalog (`GET /chains`) so native-token wrapping is
   * permitted automatically. Project-scoped — needs the API key but no account.
   * Resolves served settlement addresses and verifies deployed UniversalActionPolicy
   * copies against the canonical bytecode. Store the resolved session rather than
   * rebuilding an authorized definition under changing catalog defaults.
   * For a fully offline build, use the standalone `toSession` and pass
   * `wrappedNativeToken` yourself.
   * @param definition The session definition
   * @returns The resolved session
   */
  createSession(definition: SessionDefinition): Promise<Session> {
    return this.#sdk.composition.project.createSession(definition)
  }

  /**
   * Validate a session definition with the same reads as `createSession`.
   *
   * Reports stable refusal codes instead of throwing the first refusal. Network
   * failures still throw. Successful validation includes access and settlement
   * coverage metadata; it does not enable or sign the session.
   * For a network-free check, use `validateSession` from `@rhinestone/sdk/smart-sessions`.
   * @param definition The session definition to resolve
   * @returns Refusals, warnings and successful access/coverage metadata
   * @example
   * ```ts
   * const { refusals, access } = await sdk.validateSession(definition)
   * for (const { code, message } of refusals) console.warn(code, message)
   * if (access?.kind === 'open') console.warn('The session keeps a wildcard fallback')
   * ```
   */
  validateSession(definition: SessionDefinition): Promise<SessionValidation> {
    return this.#sdk.composition.project.validateSession(definition)
  }
}

export { RhinestoneSDK }
