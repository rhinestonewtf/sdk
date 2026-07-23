import type { Account } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { SignerSet } from '../config/account'
import type { ResolvedAccountConfig } from '../config/resolved'
import { defineValidator } from '../modules/validators/definition'
import {
  ecdsaSignerId,
  webauthnSignerId,
} from '../modules/validators/signer-id'
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

export function adaptSignerSelection(
  account: ResolvedAccountConfig,
  signers: SignerSet,
): AdaptedSignerSelection {
  if (signers.type === 'session') {
    return adaptSessionSelection(signers)
  }
  return adaptOwnerSelection(account, signers)
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
