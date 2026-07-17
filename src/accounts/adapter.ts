import type { Hex } from 'viem'
import type { EvmChainReference } from '../chains/types'
import type { ResolvedModule } from '../modules/types'
import type {
  AccountCallEncodingInput,
  AccountCapabilities,
  AccountConstruction,
  AccountDefinition,
  AccountDeploymentPlan,
  AccountEip7702AdoptionPlan,
  AccountIdentity,
  AccountSignatureEnvelope,
} from './types'

export interface AccountSignatureEnvelopeInput {
  readonly account: AccountIdentity
  readonly envelope: AccountSignatureEnvelope
  readonly validatorContribution: Hex
  readonly purpose: 'erc1271' | 'intent' | 'user-operation'
}

export interface AccountAdapter {
  readonly account: AccountDefinition
  readonly capabilities: AccountCapabilities
  readonly getIdentity: (input: AccountConstruction) => AccountIdentity
  readonly getDeploymentPlan: (
    input: AccountConstruction,
  ) => AccountDeploymentPlan
  readonly getEip7702AdoptionPlan?: (
    input: AccountConstruction,
  ) => AccountEip7702AdoptionPlan
  readonly encodeCalls: (input: AccountCallEncodingInput) => Hex
  readonly encodeModuleInstallation: (module: ResolvedModule) => readonly Hex[]
  readonly encodeModuleUninstallation: (module: ResolvedModule) => Hex
  readonly encodeSignatureEnvelope: (
    input: AccountSignatureEnvelopeInput,
  ) => Hex
}

export interface AccountRuntime {
  readonly adapter: AccountAdapter
  readonly construction: AccountConstruction
  readonly identity: AccountIdentity
}

export interface AccountRuntimePort {
  readonly forChain: (chain: EvmChainReference) => Promise<AccountRuntime>
}
