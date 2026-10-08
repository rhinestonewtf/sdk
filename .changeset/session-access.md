---
'@rhinestone/sdk': minor
---

Add `access` to every created `Session`, and export its `SessionAccess` type. `access.kind` is `'scoped'` when the session key is held to the session's own actions, and `'open'` when the session keeps the wildcard fallback action. That fallback carries intent-execution, so the key may also call any target the global intent-execution whitelist allows; a session with no actions, permissions or permits has a sudo fallback instead. `access.reason` says what decided it (`restrictToActions`, a `swap` scope, a settlement-scoped permit and its layers, a Permit2-route permit and its layers, `claimPolicies`, or no restriction) for people to read; its wording is not a stable contract, so branch on `kind`. The field is metadata only: the session's encoding and permission id are unchanged, and stored sessions without it still work.
