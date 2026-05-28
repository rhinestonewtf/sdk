---
'@rhinestone/sdk': patch
---

Fix `experimental_enableSession` dropping `permissions` on scoped sessions, which caused the emissary to reject the enable. The function now accepts a resolved `Session` (was `SessionInput`).
