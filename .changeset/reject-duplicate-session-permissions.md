---
'@rhinestone/sdk': patch
---

Reject duplicate session permissions for the same function on the same contract at session build time. Previously they were silently accepted, but on-chain they share one action config, so the later entry's policies overwrote the earlier ones and calls permitted by the earlier entry failed with `InvalidSignature()` at execution.
