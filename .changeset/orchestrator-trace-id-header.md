---
"@rhinestone/sdk": patch
---

Orchestrator errors take their trace id from the `x-trace-id` response header where the runtime can read it, falling back to the response body. `InsufficientLiquidityError` from `splitIntents` now carries one when the header is readable.
