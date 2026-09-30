---
'@rhinestone/sdk': minor
---

Add and remove secp256k1 (ECDSA) keys on a managed Solana account's Swig, and check whether an authority change is already in place. Pass `{ destination: { chain, authority: addEcdsaKey(key, { permission }) } }` or `{ destination: { chain, authority: removeEcdsaKey(key) } }` to `prepareTransaction`, then sign, submit and wait as usual.

- `addEcdsaKey` and `removeEcdsaKey` come from `@rhinestone/sdk/solana`. They take a viem local account or a secp256k1 public key (33-byte compressed, 65-byte uncompressed or 64-byte x‖y), and compress it. An uncompressed key must lie on secp256k1. An EVM address, a WebAuthn account, or an account without a `publicKey` is refused with `UnsupportedAccountCapabilityError`.
- Every key kind takes every Swig permission, always explicit: `all`, `allButManageAuthority` or the new `manageAuthority`. `addPasskey` accepts `manageAuthority` too. `manageAuthority` adds and removes non-root authorities, including granting `all`, so it is takeover power; it never spends or runs instructions.
- An account configured with a manage-only key as its `{ type: 'ecdsa', account }` owner, including an external viem `toAccount` signer, can add and remove authorities. The orchestrator refuses its spends.
- `account.getAuthorityStatus({ destination: { chain, authority } })` returns `applied`, `notApplied` or `conflict` without signing or submitting. It quotes the change and reads the orchestrator's refusal, so it needs a configured owner able to manage authorities. Under JWT auth, it mints one sponsorship grant that is never used. Settle an in-flight intent before trusting `notApplied`. Available on standalone and composite accounts with a managed Solana entry.
- Widened types: `SolanaAuthorityKey` is now a `passkey` | `ecdsa` union; the new `SolanaAuthorityPermission` replaces `SolanaPasskeyPermission`, which stays as a deprecated alias; `SolanaAuthorityExecutionMetadata` gains `keyType`; and `SolanaAuthorityChangeRefusedError.permission` and `SolanaAuthorityDisclosure` (`key.kind`, `permission`) cover the new key kind and permission. Exhaustive switches over them need the new cases.
- New public types: `SolanaAuthorityPermission` and `SolanaAuthorityStatus`.
- Needs an orchestrator that accepts secp256k1 keys and `manageAuthority` (dev today). An older orchestrator refuses them with a `ValidationError` before anything is signed.
