---
'@rhinestone/sdk': major
---

- Drop the unused `feeToken` field from the `Cost` response and remove the public `FeeToken` type. The orchestrator's blanc `POST /quotes` response never populates this field.
