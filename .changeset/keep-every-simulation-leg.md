---
'@rhinestone/sdk': major
---

`SimulationFailedError.simulations` now holds every simulated claim and fill leg in order, including legs that passed, and drops the deprecated `call` and `details` fields.

- Each entry is `{ success: false, … }` (with `errorSelector`, `errorName`, `errorArgs`, `errorCategory`, `revertedBy`) or `{ success: true, action, chainId, gasEstimation }`. Narrow on `success` before reading error fields, and filter on `!leg.success` where you only want the legs that failed.
- `simulations[].call` and `simulations[].details`, always `undefined` since they were deprecated, are removed.
