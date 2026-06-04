---
'@rhinestone/sdk': patch
---

Retry transient transport errors (socket closed, connection reset, DNS/TLS failures) while polling intent status in `waitForExecution`, instead of treating them as terminal. These bubble up untyped from `fetch` and were previously surfaced as bridge failures despite the intent still settling. Detection is exposed as `isConnectionError`.
