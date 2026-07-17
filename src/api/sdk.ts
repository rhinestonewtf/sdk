import type { SdkConstructionInput } from '../config/input'
import type { AppFeeBalances, SplitIntentsInput } from '../orchestrator'
import type { RhinestoneAccountConfig, RhinestoneSDKConfig } from '../types'
import type { RhinestoneAccount } from './account'
import { attachAccount, composeSdk, type SdkComposition } from './accounts'

/**
 * Stateful entry point that holds shared configuration (auth, provider,
 * bundler, paymaster) and creates accounts from it, delegating all work to the
 * SDK-core composition.
 */
class RhinestoneSDK {
  readonly #sdk: SdkComposition

  /**
   * Create a Rhinestone SDK instance.
   * @param options Shared configuration applied to every account created by this instance
   */
  constructor(options: RhinestoneSDKConfig) {
    this.#sdk = composeSdk(options as unknown as SdkConstructionInput)
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
  createAccount(config: RhinestoneAccountConfig): Promise<RhinestoneAccount> {
    return Promise.resolve(attachAccount(this.#sdk, config))
  }

  /**
   * Get the current status of a submitted intent.
   * @param intentId The intent ID returned when the transaction was submitted
   * @returns The intent status
   */
  getIntentStatus(intentId: string) {
    return this.#sdk.composition.project.getIntentStatus(intentId)
  }

  /**
   * Split a transaction into multiple intents across chains.
   * @param input The intents to split
   * @returns The split-intents result
   */
  splitIntents(input: SplitIntentsInput) {
    return this.#sdk.composition.project.splitIntents(
      input as unknown as Parameters<
        SdkComposition['composition']['project']['splitIntents']
      >[0],
    )
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

export { RhinestoneSDK }
