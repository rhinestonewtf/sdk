---
"@rhinestone/sdk": patch
---

Orchestrator errors take their trace id from the `x-trace-id` response header, so `InsufficientLiquidityError` from `splitIntents` now carries one.
