import type { ResolvedModule } from '../types'
import { resolveEnsValidator } from './ens'
import { resolveMultiFactorValidator } from './multi-factor'
import { resolveOwnableValidator } from './ownable'
import type {
  AtomicValidatorDefinition,
  ResolvedValidatorDefinition,
} from './types'
import {
  resolveWebauthnValidator,
  type WebauthnCredentialOrdering,
} from './webauthn'

export function resolveAtomicValidator(
  definition: AtomicValidatorDefinition,
  webauthnOrdering?: WebauthnCredentialOrdering,
): ResolvedModule {
  switch (definition.kind) {
    case 'ecdsa':
      return resolveOwnableValidator(definition)
    case 'ens':
      return resolveEnsValidator(definition)
    case 'passkey':
      return resolveWebauthnValidator(definition, webauthnOrdering)
    case 'k1':
    case 'smart-session':
      throw new Error(`Validator ${definition.kind} requires feature input`)
  }
}

// `webauthnOrdering` only applies to a top-level passkey validator: multi-factor
// stores its sub-validator data without ever calling the sub-validator's
// `onInstall`, so the ascending rule never runs and its bytes must not move.
export function resolveValidator(
  definition: ResolvedValidatorDefinition,
  webauthnOrdering?: WebauthnCredentialOrdering,
): ResolvedModule {
  return definition.kind === 'multi-factor'
    ? resolveMultiFactorValidator(definition, resolveAtomicValidator)
    : resolveAtomicValidator(definition, webauthnOrdering)
}
