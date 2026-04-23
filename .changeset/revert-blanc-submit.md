---
"@rhinestone/sdk": patch
---

Revert the `2026-04.blanc` orchestrator submit schema and restore the `2026-01.alps` API version. Submit requests again send `{ signedIntentOp }` and expect the nested `result.id`/`status` intent response.
