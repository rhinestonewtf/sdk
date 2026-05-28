---
'@rhinestone/sdk': major
---

Drop the unused `feeToken` field from the `Cost` response and remove the public `FeeToken` type. The orchestrator never populated this field.
