import type { SdkConstructionInput } from '../config/input'
import type { AppFeeBalances, SplitIntentsInput } from '../orchestrator'
import type { RhinestoneAccountConfig, RhinestoneSDKConfig } from '../types'
import type { RhinestoneAccount } from './account'
import { attachAccount, composeSdk, type SdkComposition } from './accounts'

/**
 * Stateful entry point that holds shared configuration and creates accounts
 * from it, delegating all work to the SDK-core composition.
 */
class RhinestoneSDK {
  readonly #sdk: SdkComposition

  constructor(options: RhinestoneSDKConfig) {
    this.#sdk = composeSdk(options as unknown as SdkConstructionInput)
  }

  createAccount(config: RhinestoneAccountConfig): Promise<RhinestoneAccount> {
    return Promise.resolve(attachAccount(this.#sdk, config))
  }

  getIntentStatus(intentId: string) {
    return this.#sdk.composition.project.getIntentStatus(intentId)
  }

  splitIntents(input: SplitIntentsInput) {
    return this.#sdk.composition.project.splitIntents(
      input as unknown as Parameters<
        SdkComposition['composition']['project']['splitIntents']
      >[0],
    )
  }

  getAppFeeBalances(): Promise<AppFeeBalances> {
    return this.#sdk.composition.project.getAppFeeBalances() as Promise<AppFeeBalances>
  }
}

export { RhinestoneSDK }
