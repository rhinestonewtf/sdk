import type { Hex } from 'viem'
import type {
  AccountCallEncodingInput,
  AccountCapabilities,
  AccountDefinition,
  AccountDeploymentPlan,
  AccountIdentity,
  AccountModulePlan,
  AccountSignatureEnvelope,
} from './types'

export interface AccountAdapterInput {
  readonly account: AccountDefinition
  readonly deployment: AccountDeploymentPlan
  readonly modules: AccountModulePlan
}

export interface AccountSignatureEnvelopeInput {
  readonly account: AccountIdentity
  readonly envelope: AccountSignatureEnvelope
  readonly validatorContribution: Hex
  readonly purpose: 'erc1271' | 'intent' | 'user-operation'
}

export interface AccountAdapter {
  readonly account: AccountDefinition
  readonly capabilities: AccountCapabilities
  readonly getIdentity: (input: AccountAdapterInput) => AccountIdentity
  readonly getDeploymentPlan: (
    input: AccountAdapterInput,
  ) => AccountDeploymentPlan
  readonly encodeCalls: (input: AccountCallEncodingInput) => Hex
  readonly encodeSignatureEnvelope: (
    input: AccountSignatureEnvelopeInput,
  ) => Hex
}
