import type {
  AccountConstructionInput,
  SdkConstructionInput,
} from '../config/input'
import {
  captureLegacySdkConfig,
  createLegacyAccountConfig,
  type LegacyAccountConfig,
  type LegacySdkConfigSnapshot,
} from '../config/legacy'
import { resolveSdkConfig } from '../config/resolve'
import type { RhinestoneAccountConfig } from '../types'
import { createAccountFacade, type RhinestoneAccount } from './account'
import { createConfiguredCoreComposition } from './compose'
import type { CoreComposition } from './compose-types'

export interface SdkComposition {
  readonly composition: CoreComposition<LegacyAccountConfig<unknown>>
  readonly snapshot: LegacySdkConfigSnapshot<unknown>
}

export function composeSdk(input: SdkConstructionInput): SdkComposition {
  const resolved = resolveSdkConfig(input)
  return {
    composition:
      createConfiguredCoreComposition<LegacyAccountConfig<unknown>>(resolved),
    snapshot: captureLegacySdkConfig(input, resolved.auth),
  }
}

export function attachAccount(
  sdk: SdkComposition,
  config: RhinestoneAccountConfig,
): RhinestoneAccount {
  const compatibilityConfig = createLegacyAccountConfig(
    config as unknown as AccountConstructionInput,
    sdk.snapshot,
  )
  return createAccountFacade(compatibilityConfig, sdk.composition)
}
