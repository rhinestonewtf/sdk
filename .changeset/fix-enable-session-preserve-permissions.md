---
'@rhinestone/sdk': patch
---

Fix `experimental_enableSession` dropping `permissions` for scoped sessions. The function accepted `SessionInput` and re-ran `toSession` on it inside `resolve`, but callers pass a resolved `Session` (which carries the derived `actions` but not the original `SessionDefinition.permissions`). The re-resolution treated `permissions` as undefined and replaced the action set with a sole `sudoAction`, so the on-chain digest computed by `SmartSessionLens.getAndVerifyDigest` no longer matched the digest signed in `getSessionDetails` and the emissary rejected the enable. The parameter type is now `Session` and the resolved value is passed straight to `getEnableSessionCall`.
