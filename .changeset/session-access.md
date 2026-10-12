---
'@rhinestone/sdk': minor
---

Add `access` to every created `Session`, and export its `SessionAccess` type. `access.kind` is `'scoped'` when the session key is held to the session's own actions, and `'open'` when the session keeps a wildcard fallback action. That fallback carries Rhinestone's intent-execution policy, or the sudo policy for a session with no actions, permissions or permits, or with `fallback: 'sudo'`. `access.reason` says what decided it (`restrictToActions`, a `swap` scope, a settlement-scoped or Permit2-route permit and its layers, `fallback`, `claimPolicies`, or no restriction) for people to read; its wording is not a stable contract, so branch on `kind`. The field is metadata only: it does not change the session's encoding, and stored sessions without it still work.
