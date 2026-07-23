import type { ConfigProfileId, ResolvedSdkDefaultSelections } from './resolved'

export interface SemanticConfigDefaults extends ResolvedSdkDefaultSelections {
  readonly id: ConfigProfileId
}

export interface SdkSemanticConfigDefaults extends SemanticConfigDefaults {
  readonly id: 'current-v2'
}

const baseDefaults = {
  orchestratorUrl: 'https://v1.orchestrator.rhinestone.dev',
  environment: 'production',
  provider: 'public',
  account: { kind: 'nexus' },
} as const

export const currentV2Defaults: SdkSemanticConfigDefaults = Object.freeze({
  ...baseDefaults,
  id: 'current-v2',
  account: {
    ...baseDefaults.account,
    safeAdapterProfile: 'safe-current-adapter' as const,
  },
})

export const legacyV0Defaults: SemanticConfigDefaults = Object.freeze({
  ...baseDefaults,
  id: 'legacy-v0',
  account: {
    ...baseDefaults.account,
    safeAdapterProfile: 'safe-legacy-v0-adapter' as const,
  },
})

export const standaloneDefaults = {
  'current-v2': currentV2Defaults,
  'legacy-v0': legacyV0Defaults,
} as const satisfies Readonly<Record<ConfigProfileId, SemanticConfigDefaults>>
