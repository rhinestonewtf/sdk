import { ecdsaSignerId, webauthnSignerId } from './signer-id'
import type {
  AtomicValidatorDefinition,
  AtomicValidatorInput,
  MultiFactorValidatorDefinition,
  ResolvedValidatorDefinition,
  ValidatorInput,
  ValidatorModuleSelection,
  ValidatorOwner,
} from './types'

function moduleSelection(
  address: `0x${string}` | undefined,
  profile: Extract<ValidatorModuleSelection, { source: 'default' }>['profile'],
): ValidatorModuleSelection {
  return address === undefined
    ? { source: 'default', profile }
    : { source: 'explicit', address }
}

function defineAtomicValidator(
  input: AtomicValidatorInput,
  id: string,
  publicId: number,
): AtomicValidatorDefinition {
  const ownerId = (index: number): string => `${id}/owner/${index}`
  switch (input.type) {
    case 'ecdsa':
      return {
        kind: 'ecdsa',
        id,
        publicId,
        module: moduleSelection(input.module, 'ownable'),
        owners: input.accounts.map(
          (account, index): ValidatorOwner => ({
            kind: 'ecdsa',
            id: ownerId(index),
            signerId: ecdsaSignerId(account),
            account,
          }),
        ),
        threshold: input.threshold ?? 1,
      }
    case 'ens':
      return {
        kind: 'ens',
        id,
        publicId,
        module: moduleSelection(undefined, 'ens'),
        owners: input.owners.map(
          (owner, index): ValidatorOwner => ({
            kind: 'ens',
            id: ownerId(index),
            signerId: ecdsaSignerId(owner.account),
            account: owner.account,
            ...(owner.expiration ? { expiration: owner.expiration } : {}),
          }),
        ),
        threshold: input.threshold ?? 1,
      }
    case 'passkey':
      return {
        kind: 'passkey',
        id,
        publicId,
        module: moduleSelection(input.module, 'webauthn'),
        owners: input.accounts.map(
          (account, index): ValidatorOwner => ({
            kind: 'webauthn',
            id: ownerId(index),
            signerId: webauthnSignerId(account),
            account,
          }),
        ),
        threshold: input.threshold ?? 1,
      }
  }
}

export function defineValidator(
  input: ValidatorInput,
  id = 'owner-validator',
  publicId: number | `0x${string}` = 0,
): ResolvedValidatorDefinition {
  if (input.type !== 'multi-factor') {
    return defineAtomicValidator(input, id, Number(publicId))
  }
  const definition: MultiFactorValidatorDefinition = {
    kind: 'multi-factor',
    id,
    publicId,
    module: moduleSelection(input.module, 'multi-factor'),
    validators: input.validators.map((validator, index) =>
      defineAtomicValidator(validator, `${id}/factor/${index}`, index),
    ),
    threshold: input.threshold ?? 1,
  }
  return definition
}
