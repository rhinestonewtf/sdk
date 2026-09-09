---
'@rhinestone/sdk': minor
---

Add `saltMode: 'strict'` to sessions: an opt-in salt derivation for restricted sessions that hashes everything `_enablePolicies` writes under the permissionId (actions, ERC-1271 policies, ERC-7739 content, claim policies), with actions in a canonical order.

The default `'v1'` derivation hashes actions only, so two restricted sessions with the same actions but a different signing config share a permissionId — and because on-chain `enable` adds to the policy list rather than replacing it, the narrower session silently unions with the broader one. `'strict'` binds the permissionId to the full session config and matches the 2.x derivation, so a session built on either major lands on the same permissionId.

Opt-in: nothing changes unless a caller passes `saltMode: 'strict'`; the default and explicit `'v1'` salts are byte-for-byte unchanged.
