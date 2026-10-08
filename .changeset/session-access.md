---
'@rhinestone/sdk': minor
---

Add `access` to every created `Session`, and export its `SessionAccess` type. `access.kind` is `'scoped'` when the session key is held to the session's own actions, and `'open'` when the session keeps the wildcard intent-execution fallback, so the key may also call any target the global intent-execution whitelist allows. `access.reason` names what decided it: `restrictToActions`, a `swap` scope, a settlement-scoped permit with its layers, a Permit2-route permit with its layers, `claimPolicies`, or no restriction. The field is metadata only: the session's encoding and permission id are unchanged, and stored sessions without it still work.
