---
'@rhinestone/sdk': patch
---

Fix `uninstallModule` reverting on Nexus, Safe7579, and Startale accounts. This unblocks every module disable action on those accounts — `ecdsa.disable`, `passkeys.disable`, `mfa.disable`, `experimental_disable` (smart sessions), and the generic `uninstallModule(module)` — all of which were silently broken on Nexus before. Kernel and EOA paths are unaffected.
