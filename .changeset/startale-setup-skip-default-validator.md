---
'@rhinestone/sdk': patch
---

Fix `setup()` reverting on Startale K1 accounts: skip the built-in K1 default validator so only genuinely missing modules (e.g. the intent executor) are installed.
