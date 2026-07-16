import type { AccountCapabilities, AccountIdentity } from '../accounts/types'
import type {
  ResolvedValidatorDefinition,
  ValidatorCapabilities,
} from '../modules/validators/types'
import type {
  EffectiveSignerSelection,
  SignerInvocationPort,
  SignerReference,
} from './types'

export interface SigningContext {
  readonly account: AccountIdentity
  readonly accountCapabilities: AccountCapabilities
  readonly validator: ResolvedValidatorDefinition
  readonly validatorCapabilities: ValidatorCapabilities
  readonly effectiveSigners: EffectiveSignerSelection
  readonly signerReferences: Readonly<Record<string, SignerReference>>
  readonly signerInvoker: SignerInvocationPort
}
