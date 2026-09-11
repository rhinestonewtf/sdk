---
'@rhinestone/sdk': minor
---

Expose the HyperCore trade outcome as `hyperCore` (the new `IntentHyperCoreResult` type) on intent status and on a failed intent's `IntentFailedError` context, so integrators can tell a refused trade from a partial one, whose placed orders a retry would send twice.
