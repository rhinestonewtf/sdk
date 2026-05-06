---
'@rhinestone/sdk': major
---

- Drop the `account.sendTransaction(transaction)` shortcut. Use the `prepareTransaction` → `signTransaction` → `submitTransaction` flow instead.
