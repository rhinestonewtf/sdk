---
'@rhinestone/sdk': minor
---

Add `saltMode` to opt a restricted session's salt into the 2.x derivation.

Additive and off by default: without it the salt stays the actions-only hash this SDK already produces, so every existing session's digest, permissionId and stored signature are unchanged.

A session's permissionId is `keccak(sessionValidator, sessionValidatorInitData, salt)`, and on-chain `enable` adds to the policy list rather than replacing it — so two sessions sharing a permissionId union rather than one superseding the other. The default salt hashes the actions alone, which is enough to keep restricted sessions apart here: a restricted session throws on `claimPolicies` and has its ERC-1271 and ERC-7739 config forced empty, so no two of them can differ by anything else.

`'strict'` hashes those fields anyway, with actions in a canonical order, matching the 2.x derivation exactly. That is what it is for: a scoped session built here can then be rebuilt on 2.x — as the deposit service does — and land on the same digest.
