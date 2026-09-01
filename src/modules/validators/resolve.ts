import type { Hex } from 'viem'
import type { ResolvedModule } from '../types'
import { encodeEnsStatelessData, resolveEnsValidator } from './ens'
import { resolveMultiFactorValidator } from './multi-factor'
import { resolveOwnableStatelessData, resolveOwnableValidator } from './ownable'
import { resolveQuorumValidator } from './quorum'
import type {
  AtomicValidatorDefinition,
  ResolvedValidatorDefinition,
} from './types'
import {
  resolveWebauthnStatelessData,
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
    case 'quorum':
      return resolveQuorumValidator(definition)
    case 'ens':
      return resolveEnsValidator(definition)
    case 'passkey':
      return resolveWebauthnValidator(definition, webauthnOrdering)
    case 'k1':
    case 'smart-session':
      throw new Error(`Validator ${definition.kind} requires feature input`)
  }
}

// What a validator's `validateSignatureWithData` expects as its `data`. Only
// Ownable's happens to equal its install data; for WebAuthn and ENS the two
// differ, and multi-factor factor slots need this one.
export function resolveAtomicValidatorStatelessData(
  definition: AtomicValidatorDefinition,
): Hex {
  switch (definition.kind) {
    case 'ecdsa':
      return resolveOwnableStatelessData(definition)
    case 'ens':
      return encodeEnsStatelessData(definition)
    case 'passkey':
      return resolveWebauthnStatelessData(definition)
    case 'quorum':
      throw new Error(
        'Validator quorum cannot be used as a multi-factor factor',
      )
    case 'k1':
    case 'smart-session':
      throw new Error(`Validator ${definition.kind} requires feature input`)
  }
}

export function resolveAtomicValidatorFactor(
  definition: AtomicValidatorDefinition,
) {
  return {
    module: resolveAtomicValidator(definition),
    statelessData: resolveAtomicValidatorStatelessData(definition),
  }
}

// `webauthnOrdering` only applies to a top-level passkey validator: multi-factor
// stores the stateless configuration for its factors, whose credential order is
// fixed by the pinned account the IDs are derived from.
export function resolveValidator(
  definition: ResolvedValidatorDefinition,
  webauthnOrdering?: WebauthnCredentialOrdering,
): ResolvedModule {
  return definition.kind === 'multi-factor'
    ? resolveMultiFactorValidator(definition, resolveAtomicValidatorFactor)
    : resolveAtomicValidator(definition, webauthnOrdering)
}
