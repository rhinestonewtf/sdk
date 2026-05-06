---
'@rhinestone/sdk': major
---

- Reshape `account.submitTransaction` to take an options bag: `submitTransaction(signed, { authorizations?, internal_dryRun? })` instead of positional `submitTransaction(signed, authorizations?, dryRun?)`.
