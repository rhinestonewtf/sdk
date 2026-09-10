---
'@rhinestone/sdk': minor
---

Add `saltMode` to opt a restricted session's permissionId into a salt.

Additive and off by default: without it the salt stays `zeroHash`, so every existing session's digest, permissionId and stored signature are unchanged.

A session's permissionId is `keccak(sessionValidator, sessionValidatorInitData, salt)` — the actions are not in it. On-chain, `enable` ADDS to the policy list rather than replacing it (`ConfigLibV2.enable`), so two restricted sessions for one signer that share a permissionId union: the earlier session's actions stay authorised and the later restriction buys nothing, with no error. A caller can believe a key is limited to one swap venue while a previously enabled wildcard action is still live.

- `'none'` (default) — `zeroHash`, today's behaviour.
- `'v1'` — hashes the actions in build order, matching the 1.x derivation, so a session built on 1.x can be rebuilt here.
- `'strict'` — hashes every field enabled under the permissionId (actions, ERC-1271 policies, ERC-7739 content, claim policies), actions in canonical order.

Unrestricted sessions stay on `zeroHash` in every mode: there is only one shape of them, so two for the same signer are the same session and sharing a permissionId is correct.
