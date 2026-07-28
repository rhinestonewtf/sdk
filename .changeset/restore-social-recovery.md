---
'@rhinestone/sdk': minor
---

Bring back social recovery. Add `recovery` to the account config, a `guardians` signer set for UserOperations, and the `@rhinestone/sdk/actions/recovery` subpath with `enable`, `recoverEcdsaOwnership`, and `recoverPasskeyOwnership`.

Recovery calls are ordered additions, then threshold, then removals. The previous implementation emitted the threshold change first and removed passkey credentials before adding them, which reverted with `InvalidThreshold` when raising the threshold and `CannotRemoveCredential` when rotating a 1-of-1 passkey account.

Guardians only sign UserOperations — the validator rejects ERC-1271 signatures and intents — and each returned call must be sent as its own UserOperation.

`recoverPasskeyOwnership` takes `currentCredentials`, the account's complete current credential set. Passing only the credentials being replaced makes it re-add an installed credential, which reverts with `CredentialAlreadyExists`.

`recovery` is also honored when an account config is used as an intent recipient, so recipient deployment installs the validator and derives the matching address.
