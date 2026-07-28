import type { Account } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { SignerSet } from '../config/account'
import type { ResolvedAccountConfig } from '../config/resolved'
import { SignerNotSupportedError } from '../errors/execution'
import { defineValidator } from '../modules/validators/definition'
import {
  ecdsaSignerId,
  webauthnSignerId,
} from '../modules/validators/signer-id'
import { SOCIAL_RECOVERY_VALIDATOR_ADDRESS } from '../modules/validators/social-recovery'
import type {
  AtomicValidatorDefinition,
  ResolvedValidatorDefinition,
  ValidatorOwner,
} from '../modules/validators/types'
import type { OwnerSignerSelection } from '../signing/types'
import type { IntentSessionSelection } from '../transactions/intents/types'

type PublicOwnerSelection = Extract<SignerSet, { type: 'owner' }>

export type AdaptedSignerSelection =
  | OwnerSignerSelection
  | IntentSessionSelection

/**
 * Adapts a signer selection for the intent and ERC-1271 flows.
 *
 * Rejects guardians: the social recovery validator reverts on
 * `isValidSignatureWithSender` and only validates UserOperations, so a
 * guardian signature could never be verified on these paths. Use
 * {@link adaptUserOperationSignerSelection} for the UserOperation flow.
 */
export function adaptSignerSelection(
  account: ResolvedAccountConfig,
  signers: SignerSet,
): AdaptedSignerSelection {
  if (signers.type === 'guardians') {
    throw new SignerNotSupportedError()
  }
  return adaptAnySignerSelection(account, signers)
}

/**
 * Adapts a signer selection for the UserOperation flow, where guardians are
 * the one supported non-owner signer.
 */
export function adaptUserOperationSignerSelection(
  account: ResolvedAccountConfig,
  signers: SignerSet,
): AdaptedSignerSelection {
  return adaptAnySignerSelection(account, signers)
}

function adaptAnySignerSelection(
  account: ResolvedAccountConfig,
  signers: SignerSet,
): AdaptedSignerSelection {
  if (signers.type === 'session') {
    return adaptSessionSelection(signers)
  }
  if (signers.type === 'guardians') {
    return adaptGuardianSelection(signers)
  }
  return adaptOwnerSelection(account, signers)
}

/**
 * Adapts a guardian selection onto the social recovery validator.
 *
 * The module shares the ownable validator's threshold-ECDSA shape, so it
 * resolves as an ECDSA validator pinned to the recovery module address. The
 * threshold is the number of supplied guardians: the validator reads exactly
 * `threshold` signatures onchain and sorts the recovered signers itself, so
 * every guardian passed here must sign and their order is irrelevant.
 */
function adaptGuardianSelection(
  signers: Extract<SignerSet, { type: 'guardians' }>,
): OwnerSignerSelection {
  if (signers.guardians.length === 0) {
    throw new Error('Guardian signer selection requires at least one guardian')
  }
  return {
    kind: 'owner',
    validator: defineValidator(
      {
        type: 'ecdsa',
        accounts: signers.guardians,
        threshold: signers.guardians.length,
        module: SOCIAL_RECOVERY_VALIDATOR_ADDRESS,
      },
      'recovery-validator',
    ),
    signerIds: signers.guardians.map(ecdsaSignerId),
  }
}

function adaptOwnerSelection(
  account: ResolvedAccountConfig,
  signers: PublicOwnerSelection,
): OwnerSignerSelection {
  switch (signers.kind) {
    case 'ecdsa': {
      const signerIds = signers.accounts.map(ecdsaSignerId)
      return {
        kind: 'owner',
        validator: account.owners
          ? replaceValidatorAccounts(account.owners, signers.accounts)
          : defineValidator({ type: 'ecdsa', accounts: signers.accounts }),
        signerIds,
      }
    }
    case 'passkey': {
      const signerIds = signers.accounts.map(webauthnSignerId)
      return {
        kind: 'owner',
        validator: defineValidator({
          type: 'passkey',
          accounts: signers.accounts,
          ...(signers.module ? { module: signers.module } : {}),
        }),
        signerIds,
      }
    }
    case 'multi-factor': {
      const validator = defineValidator({
        type: 'multi-factor',
        validators: signers.validators.map((factor) =>
          factor.type === 'passkey'
            ? { type: 'passkey' as const, accounts: factor.accounts }
            : { type: 'ecdsa' as const, accounts: factor.accounts },
        ),
        ...(signers.module ? { module: signers.module } : {}),
      })
      if (validator.kind !== 'multi-factor') {
        throw new Error('Multi-factor signer selection did not resolve')
      }
      return {
        kind: 'owner',
        validator: {
          ...validator,
          validators: validator.validators.map((factor, index) => ({
            ...factor,
            publicId: signers.validators[index]?.id ?? factor.publicId,
          })),
        },
        signerIds: signers.validators.flatMap((factor) =>
          factor.type === 'passkey'
            ? factor.accounts.map(webauthnSignerId)
            : factor.accounts.map(ecdsaSignerId),
        ),
      }
    }
  }
}

function replaceValidatorAccounts(
  configured: ResolvedValidatorDefinition,
  selectedAccounts: readonly (Account | WebAuthnAccount)[],
): ResolvedValidatorDefinition {
  const accounts = new Map(
    selectedAccounts.map((account) => [
      account.type === 'webAuthn'
        ? webauthnSignerId(account)
        : ecdsaSignerId(account),
      account,
    ]),
  )
  if (configured.kind === 'multi-factor') {
    return {
      ...configured,
      validators: configured.validators.map((validator) =>
        replaceAtomicValidatorAccounts(validator, accounts),
      ),
    }
  }
  return replaceAtomicValidatorAccounts(configured, accounts)
}

function replaceAtomicValidatorAccounts(
  configured: AtomicValidatorDefinition,
  accounts: ReadonlyMap<string, Account | WebAuthnAccount>,
): AtomicValidatorDefinition {
  return {
    ...configured,
    owners: configured.owners.map((owner) =>
      replaceOwnerAccount(owner, accounts.get(owner.signerId)),
    ),
  }
}

function replaceOwnerAccount(
  owner: ValidatorOwner,
  account: Account | WebAuthnAccount | undefined,
): ValidatorOwner {
  if (!account) return owner
  return owner.kind === 'webauthn' && account.type === 'webAuthn'
    ? { ...owner, account }
    : owner.kind !== 'webauthn' && account.type !== 'webAuthn'
      ? { ...owner, account }
      : owner
}

function adaptSessionSelection(
  signers: Extract<SignerSet, { type: 'session' }>,
): IntentSessionSelection {
  if ('sessions' in signers) {
    return {
      kind: 'smart-session',
      byChain: Object.fromEntries(
        Object.entries(signers.sessions).map(([chainId, selection]) => [
          Number(chainId),
          selection,
        ]),
      ),
    }
  }
  return {
    kind: 'smart-session',
    byChain: {
      [signers.session.chain.id]: {
        session: signers.session,
        ...(signers.enableData ? { enableData: signers.enableData } : {}),
      },
    },
  }
}
