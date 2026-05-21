---
'@rhinestone/sdk': patch
---

Fix `uninstallModule` reverting on Nexus, Safe7579, and Startale accounts. These ERC-7579 accounts store validators in a `SentinelList` and decode `uninstallModule`'s `deInitData` arg as `(address prev, bytes moduleDeInit)`. The SDK was passing module-level `deInitData` (typically `'0x'`) straight into that slot, which fails `abi.decode` before the linked list pop can run. `getModuleUninstallationCalls` now reads the live validator list, computes the prev pointer, and wraps `module.deInitData` as `abi.encode(prev, module.deInitData)` for validator-type uninstalls on SentinelList accounts. Kernel and EOA paths are untouched (Kernel treats the slot as raw module bytes; EOA has no modules).

Affects every existing disable action — `ecdsa.disable`, `passkeys.disable`, `mfa.disable`, `experimental_disable` (smart sessions), and the generic `uninstallModule(module)` — all of which were silently broken on Nexus before.
