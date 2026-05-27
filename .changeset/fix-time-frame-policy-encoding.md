---
'@rhinestone/sdk': patch
---

Fix the `time-frame` session policy encoding to match the deployed `TimeFramePolicy` contract. Sessions installed with a `time-frame` policy through the SDK now correctly enforce `validUntil` / `validAfter`.
