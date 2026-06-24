---
'@rhinestone/sdk': major
---

Remove the legacy social-recovery surface:

- Remove the `@rhinestone/sdk/actions/recovery` subpackage (`enable`, `recoverEcdsaOwnership`, `recoverPasskeyOwnership`).
- Remove the `recovery` field from `RhinestoneAccountConfig` and the `Recovery` type.
- Remove the `guardians` signer (`GuardiansSignerSet`) from `SignerSet`.
- Remove `SignerNotSupportedError` — it only guarded the guardian path.
