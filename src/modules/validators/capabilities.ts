import type { ResolvedModule } from '../types'
import { ENS_HCA_MODULE } from './ens'
import { K1_DEFAULT_VALIDATOR_ADDRESS } from './k1'
import {
  OWNABLE_BETA_VALIDATOR_ADDRESS,
  OWNABLE_V0_VALIDATOR_ADDRESS,
  OWNABLE_VALIDATOR_ADDRESS,
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
  const legacyOwnable = [
    OWNABLE_V0_VALIDATOR_ADDRESS.toLowerCase(),
    OWNABLE_BETA_VALIDATOR_ADDRESS.toLowerCase(),
  ].includes(module.address.toLowerCase())
  const validatorRecovery =
    purpose !== 'user-operation' &&
    [OWNABLE_VALIDATOR_ADDRESS, ENS_HCA_MODULE]
      .map((address) => address.toLowerCase())
      .includes(module.address.toLowerCase())
      ? 'validator-offset-4'
      : 'ethereum'
  return {
    compatibilityKey: {
      validatorKind: definition.kind,
      moduleAddress: module.address,
      accountProfile,
      purpose,
    },
    payloadKinds: [
      'message',
      'typed-data',
      'intent',
      'user-operation',
      'session-enable',
    ],
    signatureModes: ['owner'],
    signerTopology: nested
      ? 'nested-threshold'
      : definition.owners.length === 1
        ? 'single'
        : 'threshold',
    supportsIndependentSigning:
      definition.kind !== 'smart-session' &&
      module.address.toLowerCase() !==
        K1_DEFAULT_VALIDATOR_ADDRESS.toLowerCase(),
    supportsOriginReuse,
    supportsMockSignature: true,
    supportsEip712: !legacyOwnable,
    recoveryEncoding: validatorRecovery,
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
          ownerOrder: [...definition.owners]
            .sort((left, right) => {
              const leftIdentity =
                left.kind === 'webauthn'
                  ? left.account.publicKey
                  : left.account.address
              const rightIdentity =
                right.kind === 'webauthn'
                  ? right.account.publicKey
                  : right.account.address
              return leftIdentity.localeCompare(rightIdentity)
            })
            .map((owner) => owner.id),
          threshold: definition.threshold,
          recoveryEncoding: validatorRecovery,
        },
  }
}
