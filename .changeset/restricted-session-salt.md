---
'@rhinestone/sdk': major
---

Salt a restricted session's permissionId by the actions it authorises.

**This moves the digest and permissionId of every restricted (`restrictToActions` / `swap`-scoped) session.** Stored signatures for existing scoped sessions no longer cover the session they were collected for. Unrestricted sessions keep the zero salt and are byte-identical — their digests, permissionIds and stored signatures are unaffected.

The permissionId derives from the validator, its init data and the salt — not from the actions. With a constant salt, every session for the same signer shared one permissionId, and on-chain `enable` ADDS to the policy list rather than replacing it (`ConfigLibV2.enable`). So enabling a restricted session beside an existing one for that signer unioned the two: the earlier session's actions stayed authorised and the restriction silently bought nothing. A caller could believe a key was limited to, say, one swap venue while a previously enabled wildcard action remained usable.

Salting by the action set gives each distinct restriction its own permissionId, so it cannot merge into another. This restores the behaviour `1.x` has (`getRestrictedSessionSalt`), which `2.x` dropped.
