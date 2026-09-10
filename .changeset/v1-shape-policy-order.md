---
'@rhinestone/sdk': patch
---

`saltMode: 'v1'` now reproduces a 1.x digest in two cases it missed.

With a spend cap: the cap adds a second policy to the approve action, and it
was emitted ahead of the params policy rather than after it as 1.x does.

On dev: 1.x salts a swap-scoped session over its production venues whatever
environment it was built for, so the permissionId does not move between them.
The salt now does the same; the session keeps its dev venues.

Uncapped production scopes were already correct and are unchanged, as is any
session that does not set `saltMode`.
