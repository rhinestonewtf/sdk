import type {
  AppFeeBalances,
  SplitIntentsInput,
  SplitIntentsResult,
} from '../clients/orchestrator/public'
import type {
  OrchestratorSplitRequest,
  OrchestratorSplitResult,
} from '../clients/orchestrator/types'
import type {
  RhinestoneAccountConfig,
  RhinestoneSDKConfig,
} from '../config/account'
import type { SdkConstructionInput } from '../config/input'
import type {
  IntentStatus,
  TransactionStatus,
} from '../transactions/intents/types'
import type { RhinestoneAccount } from './account'
import { attachAccount, composeSdk, type SdkComposition } from './accounts'

/**
 * Stateful entry point that holds shared configuration (auth, provider,
 * bundler, paymaster) and creates accounts from it, delegating all work to the
 * SDK-core composition.
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

  /**
   * Create a Rhinestone SDK instance.
   * @param options Shared configuration applied to every account created by this instance
   */
  constructor(options: RhinestoneSDKConfig) {
    const input = options as unknown as SdkConstructionInput
    this.provider = input.provider
    this.bundler = input.bundler
    this.paymaster = input.paymaster
    this.endpointUrl = input.endpointUrl
    this.useDevContracts = input.useDevContracts
    this.headers = input.headers
    this.#sdk = composeSdk(input)
    this.authProvider = this.#sdk.snapshot.authProvider
  }

  /**
   * Create an account using this instance's shared configuration.
   * @param config Per-account configuration (owners, account type, modules, sessions)
   * @returns The account instance
   * @example
   * ```ts
   * import { RhinestoneSDK } from '@rhinestone/sdk'
   * import { privateKeyToAccount } from 'viem/accounts'
   *
   * const owner = privateKeyToAccount('0x...')
   *
   * const sdk = new RhinestoneSDK({
   *   auth: { mode: 'apiKey', apiKey: process.env.RHINESTONE_API_KEY! },
   * })
   *
   * const account = await sdk.createAccount({
   *   owners: { type: 'ecdsa', accounts: [owner] },
   * })
   * ```
   */
  async createAccount(
    config: RhinestoneAccountConfig,
  ): Promise<RhinestoneAccount> {
    return attachAccount(this.#sdk, config)
  }

  /**
   * Get the current status of a submitted intent.
   * @param intentId The intent ID returned when the transaction was submitted
   * @returns The intent status
   */
  getIntentStatus(intentId: string): Promise<TransactionStatus> {
    return this.#sdk.composition.project
      .getIntentStatus(intentId)
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
}

export function toPublicTransactionStatus(
  status: IntentStatus,
): TransactionStatus {
  return {
    traceId: status.traceId,
    status: status.status,
    accountAddress: status.account,
    operations: [...status.operations],
  }
}

export function toOrchestratorSplitRequest(
  input: SplitIntentsInput,
): OrchestratorSplitRequest {
  return {
    chainId: input.chain.id,
    tokens: input.tokens,
    ...(input.settlementLayers
      ? { settlementLayers: input.settlementLayers }
      : {}),
  }
}

export function toPublicSplitResult(
  result: OrchestratorSplitResult,
): SplitIntentsResult {
  return {
    traceId: result.traceId,
    intents: result.intents.map((intent) => ({ ...intent })),
  }
}

export { RhinestoneSDK }
