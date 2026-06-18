---
"@rhinestone/sdk": patch
---

Fix `enable` (ECDSA) on Nexus accounts. The OwnableValidator is the Nexus default validator and cannot be added via `installModule` (`DefaultValidatorAlreadyInstalled`); on passkey-bootstrapped accounts it is also never initialized, so `addOwner` reverts with `NotInitialized`. `enable` now initializes the default validator directly via `onInstall`, and throws a clear error (instead of an opaque simulation revert) when ECDSA is already enabled.
