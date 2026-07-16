import type { ResolvedModule } from '../types'
import {
  OWNABLE_BETA_VALIDATOR_ADDRESS,
  OWNABLE_V0_VALIDATOR_ADDRESS,
} from './ownable'
import type {
  ResolvedValidatorDefinition,
  ValidatorCapabilities,
  ValidatorSigningPurpose,
} from './types'

export function getValidatorCapabilities(
  definition: ResolvedValidatorDefinition,
  module: ResolvedModule,
  accountProfile: string,
  purpose: ValidatorSigningPurpose,
  supportsOriginReuse: boolean,
): ValidatorCapabilities {
  const nested = definition.kind === 'multi-factor'
  const webauthn =
    definition.kind === 'passkey' ||
    (nested &&
      definition.validators.some((factor) => factor.kind === 'passkey'))
  const legacyOwnable = [
    OWNABLE_V0_VALIDATOR_ADDRESS.toLowerCase(),
    OWNABLE_BETA_VALIDATOR_ADDRESS.toLowerCase(),
  ].includes(module.address.toLowerCase())
  return {
    compatibilityKey: {
      validatorKind: definition.kind,
      moduleAddress: module.address,
      accountProfile,
      purpose,
    },
    payloadKinds: ['message', 'typed-data', 'intent', 'user-operation'],
    signatureModes: ['owner'],
    signerTopology: nested
      ? 'nested-threshold'
      : definition.owners.length === 1
        ? 'single'
        : 'threshold',
    supportsIndependentSigning: definition.kind !== 'smart-session',
    supportsOriginReuse,
    supportsMockSignature: true,
    supportsEip712: !legacyOwnable,
    recoveryEncoding: webauthn ? 'validator-offset-4' : 'ethereum',
    contributionCodec: nested
      ? {
          kind: 'nested-threshold',
          validator: module,
          factorOrder: definition.validators.map((factor) => factor.id),
          threshold: definition.threshold,
        }
      : {
          kind: 'ordered-threshold',
          validator: module,
          ownerOrder: definition.owners.map((owner) => owner.id),
          threshold: definition.threshold,
          recoveryEncoding: webauthn ? 'validator-offset-4' : 'ethereum',
        },
  }
}
