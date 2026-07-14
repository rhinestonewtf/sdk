---
'@rhinestone/sdk': patch
---

Reject duplicate session permissions for the same function on the same contract at session build time. Previously they were silently accepted and collided on-chain, so only the last entry's policies took effect and calls permitted by earlier entries failed at execution.
