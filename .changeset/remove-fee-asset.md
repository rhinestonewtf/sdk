---
'@rhinestone/sdk': major
---

Remove the `feeAsset` transaction option. The orchestrator never honored it — the corresponding `feeToken` field was reserved with no effect — so choosing an ERC-20 fee asset was a no-op. Drop `feeAsset` from your `prepareTransaction` calls; it has no replacement until the feature actually ships.
