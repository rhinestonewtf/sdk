import type { ResolvedModule } from '../types'
import { resolveEnsValidator } from './ens'
import { resolveMultiFactorValidator } from './multi-factor'
import { resolveOwnableValidator } from './ownable'
import type {
  AtomicValidatorDefinition,
  ResolvedValidatorDefinition,
} from './types'
import { resolveWebauthnValidator } from './webauthn'

export function resolveAtomicValidator(
  definition: AtomicValidatorDefinition,
): ResolvedModule {
  switch (definition.kind) {
    case 'ecdsa':
      return resolveOwnableValidator(definition)
    case 'ens':
      return resolveEnsValidator(definition)
    case 'passkey':
      return resolveWebauthnValidator(definition)
    case 'k1':
    case 'smart-session':
      throw new Error(`Validator ${definition.kind} requires feature input`)
  }
}

export function resolveValidator(
  definition: ResolvedValidatorDefinition,
): ResolvedModule {
  return definition.kind === 'multi-factor'
    ? resolveMultiFactorValidator(definition, resolveAtomicValidator)
    : resolveAtomicValidator(definition)
}
