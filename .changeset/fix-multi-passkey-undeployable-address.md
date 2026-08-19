---
'@rhinestone/sdk': minor
---

Derive multi-passkey account addresses that can actually be deployed. Credentials are now installed in a canonical, order-independent order, and the account salt is deterministically searched (starting from the salt you passed) until the derived address satisfies the WebAuthn validator's ascending credential ID rule. Passkey sets that cannot be installed — duplicates, or more than six passkeys at deployment — throw `PasskeyConfigurationNotInstallableError` instead of returning an unusable address; add the remaining passkeys after deployment with `passkeys.addOwner`.

Single-passkey, ECDSA, ENS, multi-factor and every non-passkey configuration keep the exact address they derive today. A multi-passkey configuration that is deployable today but was passed in a non-canonical order moves to a new address; its old address stays reachable by pinning `initData`.
