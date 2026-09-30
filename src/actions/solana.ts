import type { Hex, LocalAccount } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import {
  canonicalSecp256k1PublicKey,
  isEvmAddressLength,
} from '../accounts/solana/keys'
import { canonicalP256PublicKey } from '../accounts/solana/passkey'
import type {
  SolanaAuthorityChange,
  SolanaAuthorityKey,
  SolanaAuthorityPermission,
} from '../config/account'
import { UnsupportedAccountCapabilityError } from '../errors/capability'

const PERMISSIONS: readonly string[] = [
  'all',
  'allButManageAuthority',
  'manageAuthority',
] satisfies readonly SolanaAuthorityPermission[]

function requirePermission(
  options: unknown,
  what: string,
): SolanaAuthorityPermission {
  const permission = (options as { permission?: unknown } | undefined)
    ?.permission
  if (typeof permission !== 'string' || !PERMISSIONS.includes(permission)) {
    throw new UnsupportedAccountCapabilityError(
      `Adding ${what} needs a \`permission\`: 'all', 'allButManageAuthority' or 'manageAuthority'.`,
      { vm: 'solana', field: 'permission' },
    )
  }
  return permission as SolanaAuthorityPermission
}

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
 * Builds the `authority` of a `{ destination: { chain, authority } }` transaction, which then
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
 * `allButManageAuthority` spends and runs instructions; `manageAuthority` adds
 * and removes non-root authorities but never spends; `all` does both. Either
 * permission that manages authorities can grant `all`, so it controls the wallet.
 * @returns A frozen `SolanaAuthorityChange` for `prepareTransaction`
 * @throws UnsupportedAccountCapabilityError when the key is malformed or the permission is missing or unknown
 * @see {@link removePasskey}
 * @example
 * ```ts
 * import { addPasskey, removePasskey, solanaDevnet } from '@rhinestone/sdk/solana'
 *
 * // Add a passkey that can spend but not manage authorities.
 * const added = await account.prepareTransaction({
 *   destination: {
 *     chain: solanaDevnet,
 *     authority: addPasskey(newPasskey, { permission: 'allButManageAuthority' }),
 *   },
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
 *   destination: {
 *     chain: solanaDevnet,
 *     authority: removePasskey(newPasskey),
 *   },
 * })
 * ```
 */
function addPasskey(
  passkey: WebAuthnAccount | Hex,
  options: { readonly permission: SolanaAuthorityPermission },
): Extract<SolanaAuthorityChange, { action: 'add' }> {
  const permission = requirePermission(options, 'a passkey')
  return Object.freeze({
    action: 'add',
    key: passkeyKey(passkey),
    permission,
  })
}

/**
 * Remove a passkey from a managed Solana account's Swig.
 *
 * Builds the `authority` of a `{ destination: { chain, authority } }` transaction.
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
 *   destination: {
 *     chain: solanaDevnet,
 *     authority: removePasskey(oldPublicKey),
 *   },
 * })
 * ```
 */
function removePasskey(
  passkey: WebAuthnAccount | Hex,
): Extract<SolanaAuthorityChange, { action: 'remove' }> {
  return Object.freeze({ action: 'remove', key: passkeyKey(passkey) })
}

function ecdsaKey(key: LocalAccount | Hex): SolanaAuthorityKey {
  const refuse = (message: string): never => {
    throw new UnsupportedAccountCapabilityError(message, {
      vm: 'solana',
      field: 'key',
    })
  }
  let publicKey: unknown = key
  if (typeof key === 'object' && key !== null) {
    const account = key as { type?: unknown; publicKey?: unknown }
    if (account.type === 'webAuthn') {
      refuse(
        'A WebAuthn account is a passkey; use `addPasskey` or `removePasskey`.',
      )
    }
    if (account.type !== 'local' || typeof account.publicKey !== 'string') {
      refuse(
        "This account exposes no public key; pass the signer's secp256k1 public key as hex.",
      )
    }
    publicKey = account.publicKey
  }
  if (isEvmAddressLength(publicKey)) {
    refuse(
      'An EVM address is not a public key; pass the secp256k1 public key the address derives from.',
    )
  }
  const canonical = canonicalSecp256k1PublicKey(publicKey)
  if (!canonical) {
    refuse(
      'The ECDSA key must be a secp256k1 public key as 33-byte compressed, 65-byte uncompressed or 64-byte x‖y hex, on the secp256k1 curve.',
    )
  }
  return Object.freeze({ type: 'ecdsa', publicKey: canonical! })
}

/**
 * Add a secp256k1 (ECDSA) key to a managed Solana account's Swig.
 *
 * Builds the `authority` of a `{ destination: { chain, authority } }` transaction, which then
 * runs through `prepareTransaction`, `signTransaction` and
 * `submitTransaction` like any other. The configured owner signs the change,
 * and the new role gets the next free role id.
 *
 * Only the public key is used; it is SEC1-compressed and lowercased. An
 * uncompressed key must lie on secp256k1. Pass the public key of the signer an
 * account will be configured with as `{ type: 'ecdsa', account }`: a compressed
 * key from another curve cannot be told apart, and would install a role no one
 * can sign for. An EVM address is refused, never read as a key.
 *
 * @param key The key to add: a viem local account, or its secp256k1 public key
 * as 33-byte compressed, 65-byte uncompressed or 64-byte x‖y hex.
 * @param options `permission`, what the new role may do (required, no default):
 * `allButManageAuthority` spends and runs instructions; `manageAuthority` adds
 * and removes non-root authorities but never spends; `all` does both. Either
 * permission that manages authorities can grant `all`, so it controls the wallet.
 * @returns A frozen `SolanaAuthorityChange` for `prepareTransaction`
 * @throws UnsupportedAccountCapabilityError when the key is an EVM address, a WebAuthn account, an account without a public key, malformed or off-curve, or the permission is missing or unknown
 * @see {@link removeEcdsaKey}
 * @example
 * ```ts
 * import { toAccount } from 'viem/accounts'
 * import { addEcdsaKey, addPasskey, solanaDevnet } from '@rhinestone/sdk/solana'
 *
 * // The passkey-root account enrolls a recovery key that can only manage authorities.
 * const enroll = {
 *   destination: {
 *     chain: solanaDevnet,
 *     authority: addEcdsaKey(recoveryPublicKey, { permission: 'manageAuthority' }),
 *   },
 * }
 * const signed = await account.signTransaction(await account.prepareTransaction(enroll))
 * await account.waitForExecution(await account.submitTransaction(signed))
 * const { status } = await account.getAuthorityStatus(enroll) // 'applied'
 *
 * // Later, the recovery signer adds a new passkey; its key never leaves the signer.
 * const recovery = await sdk.createAccount({
 *   solana: {
 *     owner: {
 *       type: 'ecdsa',
 *       account: toAccount({ address: recoveryAddress, signMessage: recoverySigner.signMessage }),
 *     },
 *     swig,
 *   },
 * })
 * await recovery.prepareTransaction({
 *   destination: {
 *     chain: solanaDevnet,
 *     authority: addPasskey(newPasskey, { permission: 'all' }),
 *   },
 * })
 * ```
 */
function addEcdsaKey(
  key: LocalAccount | Hex,
  options: { readonly permission: SolanaAuthorityPermission },
): Extract<SolanaAuthorityChange, { action: 'add' }> {
  const permission = requirePermission(options, 'an ECDSA key')
  return Object.freeze({ action: 'add', key: ecdsaKey(key), permission })
}

/**
 * Remove a secp256k1 (ECDSA) key from a managed Solana account's Swig.
 *
 * Builds the `authority` of a `{ destination: { chain, authority } }` transaction.
 * The role carrying the key is removed. The root role never is, and neither is
 * the last role able to manage authorities; the orchestrator refuses both.
 *
 * @param key The key to remove: a viem local account, or its secp256k1 public
 * key as 33-byte compressed, 65-byte uncompressed or 64-byte x‖y hex.
 * @returns A frozen `SolanaAuthorityChange` for `prepareTransaction`
 * @throws UnsupportedAccountCapabilityError when the key is an EVM address, a WebAuthn account, an account without a public key, malformed or off-curve
 * @see {@link addEcdsaKey}
 * @example
 * ```ts
 * import { removeEcdsaKey, solanaDevnet } from '@rhinestone/sdk/solana'
 *
 * const prepared = await account.prepareTransaction({
 *   destination: {
 *     chain: solanaDevnet,
 *     authority: removeEcdsaKey(recoveryPublicKey),
 *   },
 * })
 * ```
 */
function removeEcdsaKey(
  key: LocalAccount | Hex,
): Extract<SolanaAuthorityChange, { action: 'remove' }> {
  return Object.freeze({ action: 'remove', key: ecdsaKey(key) })
}

export { addEcdsaKey, addPasskey, removeEcdsaKey, removePasskey }
