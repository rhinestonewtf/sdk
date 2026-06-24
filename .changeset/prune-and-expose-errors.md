---
'@rhinestone/sdk': major
---

Clean up the `./errors` surface.

- Remove `ExistingEip7702AccountsNotSupportedError`, `SmartSessionsNotEnabledError`, and `SessionChainRequiredError`. None were ever thrown; the "session needs a chain" rule the latter described is enforced at the type level (`chain` is required on `SessionDefinition` and `Session`).
- Export `DefaultValidatorAlreadyInitializedError`, `ModuleInstallationNotSupportedError`, `EoaSigningNotSupportedError`, `EoaSigningMethodNotConfiguredError`, `OwnersFieldRequiredError`, and `Eip7702InitSignatureRequiredError`, which are thrown by the SDK but were previously not catchable by type.
