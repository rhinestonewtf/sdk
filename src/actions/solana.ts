import type { Hex } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import { canonicalP256PublicKey } from '../accounts/solana/passkey'
import type {
  SolanaAuthorityChange,
  SolanaAuthorityKey,
  SolanaPasskeyPermission,
} from '../config/account'
import { UnsupportedAccountCapabilityError } from '../errors/capability'

const PERMISSIONS: readonly string[] = [
  'all',
  'allButManageAuthority',
] satisfies readonly SolanaPasskeyPermission[]

function passkeyKey(passkey: WebAuthnAccount | Hex): SolanaAuthorityKey {
  const publicKey =
    typeof passkey === 'object' &&
    passkey !== null &&
    (passkey as { type?: unknown }).type === 'webAuthn'
      ? (passkey as WebAuthnAccount).publicKey
      : passkey
  const canonical = canonicalP256PublicKey(publicKey)
  if (!canonical) {
    throw new UnsupportedAccountCapabilityError(
      'The passkey must be a viem WebAuthn account, or a P-256 public key as 64-byte x‖y, 65-byte uncompressed or 33-byte compressed hex.',
      { vm: 'solana', field: 'passkey' },
    )
  }
  return Object.freeze({ type: 'passkey', publicKey: canonical })
}

/**
 * Add a passkey to a managed Solana account's Swig.
 *
 * Builds the `authority` of a `{ chain, authority }` transaction, which then
 * runs through `prepareTransaction`, `signTransaction` and
 * `submitTransaction` like any other.
 *
 * Only the passkey's public key is used; it is SEC1-compressed and
 * lowercased. The configured owner signs the change, and the new role gets
 * the next free role id.
 *
 * @param passkey The passkey to add: a viem WebAuthn account, or its P-256
 * public key in 64-byte x‖y, 65-byte uncompressed or 33-byte compressed form.
 * @param options `permission`, what the new role may do (required, no default):
 * `allButManageAuthority` spends and runs instructions, and `all` can also add
 * and remove passkeys.
 * @returns A frozen `SolanaAuthorityChange` for `prepareTransaction`
 * @throws UnsupportedAccountCapabilityError when the key is malformed or the permission is missing or unknown
 * @see {@link removePasskey}
 * @example
 * ```ts
 * import { addPasskey, removePasskey, solanaDevnet } from '@rhinestone/sdk/solana'
 *
 * // Add a passkey that can spend but not manage authorities.
 * const added = await account.prepareTransaction({
 *   chain: solanaDevnet,
 *   authority: addPasskey(newPasskey, { permission: 'allButManageAuthority' }),
 * })
 * const signed = await account.signTransaction(added)
 * await account.waitForExecution(await account.submitTransaction(signed))
 *
 * // An account configured with the new passkey as owner spends from the same wallet.
 * const same = await sdk.createAccount({
 *   solana: { owner: { type: 'passkey', account: newPasskey }, swig },
 * })
 *
 * // Remove it again.
 * await account.prepareTransaction({
 *   chain: solanaDevnet,
 *   authority: removePasskey(newPasskey),
 * })
 * ```
 */
function addPasskey(
  passkey: WebAuthnAccount | Hex,
  options: { readonly permission: SolanaPasskeyPermission },
): Extract<SolanaAuthorityChange, { action: 'add' }> {
  const permission = (options as { permission?: unknown } | undefined)
    ?.permission
  if (typeof permission !== 'string' || !PERMISSIONS.includes(permission)) {
    throw new UnsupportedAccountCapabilityError(
      "Adding a passkey needs a `permission`: 'all' or 'allButManageAuthority'.",
      { vm: 'solana', field: 'permission' },
    )
  }
  return Object.freeze({
    action: 'add',
    key: passkeyKey(passkey),
    permission: permission as SolanaPasskeyPermission,
  })
}

/**
 * Remove a passkey from a managed Solana account's Swig.
 *
 * Builds the `authority` of a `{ chain, authority }` transaction.
 * The role carrying the key is removed. The root role never is, and neither is
 * the last role able to manage authorities; the orchestrator refuses both.
 * Removing the configured owner's own key leaves this account unable to sign.
 *
 * @param passkey The passkey to remove: a viem WebAuthn account, or its P-256
 * public key in 64-byte x‖y, 65-byte uncompressed or 33-byte compressed form.
 * @returns A frozen `SolanaAuthorityChange` for `prepareTransaction`
 * @throws UnsupportedAccountCapabilityError when the key is malformed
 * @see {@link addPasskey}
 * @example
 * ```ts
 * import { removePasskey, solanaDevnet } from '@rhinestone/sdk/solana'
 *
 * const prepared = await account.prepareTransaction({
 *   chain: solanaDevnet,
 *   authority: removePasskey(oldPublicKey),
 * })
 * ```
 */
function removePasskey(
  passkey: WebAuthnAccount | Hex,
): Extract<SolanaAuthorityChange, { action: 'remove' }> {
  return Object.freeze({ action: 'remove', key: passkeyKey(passkey) })
}

export { addPasskey, removePasskey }
