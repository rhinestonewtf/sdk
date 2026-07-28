import { type Account, type Address, isAddressEqual } from 'viem'
import type {
  CalldataInput,
  CallResolveContext,
  LazyCallInput,
  OwnableValidatorConfig,
  WebauthnValidatorConfig,
} from '../config/account'
import { OWNABLE_VALIDATOR_ADDRESS } from '../modules/validators/ownable'
import { resolveSocialRecoveryValidator } from '../modules/validators/social-recovery'
import {
  parseWebauthnPublicKey,
  WEBAUTHN_VALIDATOR_ADDRESS,
} from '../modules/validators/webauthn'
import {
  addOwnableOwner,
  changeOwnableThreshold,
  removeOwnableOwner,
} from './ownable'
import {
  addOwner as addPasskeyOwner,
  changeThreshold as changePasskeyThreshold,
  removeOwner as removePasskeyOwner,
} from './passkeys'
import {
  readOwnershipFor,
  readThresholdFor,
  resolveValidatorInstallation,
} from './runtime'

/** Sentinel head of the validator's owner linked list. */
const SENTINEL_OWNER: Address = '0x0000000000000000000000000000000000000001'

interface PasskeyCredential {
  pubKeyX: bigint
  pubKeyY: bigint
}

export interface RecoverEcdsaOwnershipOptions extends CallResolveContext {
  /**
   * Target owner set. Existing owners not listed here are removed. If supplied,
   * `module` must match the account's configured owner validator.
   */
  newOwners: OwnableValidatorConfig
}

export interface RecoverPasskeyOwnershipOptions extends CallResolveContext {
  /**
   * The account's complete current credential set, not just the ones being
   * replaced. Credentials absent from `newOwners` are removed, and those
   * already present here are not added again — passing a partial set makes the
   * recovery re-add an installed credential, which reverts with
   * `CredentialAlreadyExists`.
   *
   * This has to be supplied because the validator stores credentials by hashed
   * id, so their coordinates cannot be read back onchain.
   */
  currentCredentials: readonly PasskeyCredential[]
  /** Target passkey owner set. */
  newOwners: WebauthnValidatorConfig
}

/**
 * Set up social recovery.
 *
 * @param guardians Guardians permitted to recover the account
 * @param threshold Guardian signatures required to recover
 * @returns Calls to install the social recovery validator
 */
function enable(guardians: Account[], threshold = 1): LazyCallInput {
  const module = resolveSocialRecoveryValidator({
    guardians: guardians.map((guardian) => guardian.address),
    threshold,
  })
  return {
    async resolve(context) {
      return resolveValidatorInstallation(context, module)
    },
  }
}

/**
 * Build the calls that rotate an account's ECDSA ownership.
 *
 * Send each returned call as its own UserOperation, in order: the social
 * recovery validator authorizes a single `execute` per UserOperation, so
 * batching them is rejected onchain.
 *
 * Ownership is only fully rotated once every call has landed. Until the
 * removals execute the previous owners stay valid alongside the new ones.
 *
 * @returns Calls to recover ownership, in the order they must be sent
 */
async function recoverEcdsaOwnership(
  options: RecoverEcdsaOwnershipOptions,
): Promise<CalldataInput[]> {
  const configuredValidator =
    options.config.owners?.type === 'ecdsa'
      ? (options.config.owners.module ?? OWNABLE_VALIDATOR_ADDRESS)
      : undefined
  const requestedValidator = options.newOwners.module
  if (
    configuredValidator &&
    requestedValidator &&
    !isAddressEqual(configuredValidator, requestedValidator)
  ) {
    throw new Error(
      'Recovery owner validator must match the configured owner validator',
    )
  }
  const validator =
    configuredValidator ?? requestedValidator ?? OWNABLE_VALIDATOR_ADDRESS
  const existing = await readOwnershipFor(
    options,
    options.accountAddress,
    validator,
  )

  const newOwners = options.newOwners.accounts
    .map((account) => account.address.toLowerCase() as Address)
    .sort()
  const newThreshold = options.newOwners.threshold ?? 1

  const ownersToAdd = newOwners.filter(
    (owner) => !existing.owners.includes(owner),
  )
  const ownersToRemove = existing.owners.filter(
    (owner) => !newOwners.includes(owner),
  )

  const calls: CalldataInput[] = []

  // Additions run first so the owner count already covers the new threshold:
  // `setThreshold` reverts while `ownerCount < threshold`. Removals run last
  // for the same reason, since `removeOwner` reverts once the count would drop
  // to the threshold.
  let currentOwners = [...existing.owners]
  for (const owner of ownersToAdd) {
    calls.push(addOwnableOwner(validator, owner))
    // The validator pushes new owners onto the front of the linked list.
    currentOwners.unshift(owner)
  }

  if (existing.threshold !== newThreshold) {
    calls.push(changeOwnableThreshold(validator, newThreshold))
  }

  for (const owner of ownersToRemove) {
    const index = currentOwners.indexOf(owner)
    const prevOwner = index <= 0 ? SENTINEL_OWNER : currentOwners[index - 1]
    calls.push(removeOwnableOwner(validator, prevOwner, owner))
    currentOwners = currentOwners.filter((entry) => entry !== owner)
  }

  return calls
}

/**
 * Build the calls that rotate an account's passkey ownership.
 *
 * Send each returned call as its own UserOperation, in order: the social
 * recovery validator authorizes a single `execute` per UserOperation, so
 * batching them is rejected onchain.
 *
 * Ownership is only fully rotated once every call has landed. Until the
 * removals execute the previous credentials stay valid alongside the new ones.
 *
 * @returns Calls to recover ownership, in the order they must be sent
 */
async function recoverPasskeyOwnership(
  options: RecoverPasskeyOwnershipOptions,
): Promise<CalldataInput[]> {
  const existingThreshold = await readThresholdFor(
    options,
    options.accountAddress,
    WEBAUTHN_VALIDATOR_ADDRESS,
  )

  const newCredentials = options.newOwners.accounts.map((account) => {
    // Must go through the shared parser: uncompressed SEC1 keys are 65 bytes
    // with an 0x04 prefix, and slicing from byte 0 shifts both coordinates.
    const { x, y } = parseWebauthnPublicKey(account.publicKey)
    return { pubKeyX: x, pubKeyY: y, requireUV: false }
  })
  const newThreshold = options.newOwners.threshold ?? 1

  const currentKeys = options.currentCredentials.map(credentialKey)
  const newKeys = newCredentials.map(credentialKey)
  const credentialsToAdd = newCredentials.filter(
    (credential) => !currentKeys.includes(credentialKey(credential)),
  )
  const credentialsToRemove = options.currentCredentials.filter(
    (credential) => !newKeys.includes(credentialKey(credential)),
  )

  const calls: CalldataInput[] = []

  // Additions run first so the credential count already covers the new
  // threshold: `setThreshold` reverts while `credentials < threshold`, and
  // `removeCredential` reverts once the count would reach the threshold.
  // Rotating the sole credential of a 1-of-1 account is impossible otherwise.
  for (const credential of credentialsToAdd) {
    calls.push(
      addPasskeyOwner(
        credential.pubKeyX,
        credential.pubKeyY,
        credential.requireUV,
      ),
    )
  }

  if (existingThreshold !== newThreshold) {
    calls.push(changePasskeyThreshold(newThreshold))
  }

  for (const credential of credentialsToRemove) {
    calls.push(removePasskeyOwner(credential.pubKeyX, credential.pubKeyY))
  }

  return calls
}

function credentialKey(credential: PasskeyCredential): string {
  return `${credential.pubKeyX}-${credential.pubKeyY}`
}

export { enable, recoverEcdsaOwnership, recoverPasskeyOwnership }
