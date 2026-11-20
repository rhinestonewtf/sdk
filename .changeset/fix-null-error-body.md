---
'@rhinestone/sdk': patch
---

Map an orchestrator error response whose JSON body is `null` or a scalar to a typed error instead of throwing a `TypeError`, so `waitForExecution` retries it like any other gateway failure.
