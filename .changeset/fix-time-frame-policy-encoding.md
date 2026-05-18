---
'@rhinestone/sdk': patch
---

Fix `getPolicyData('time-frame')` to match the deployed `TimeFramePolicy` contract. Was emitting `encodePacked(['uint48','uint48'], [validUntil, validAfter])`; now emits `encodeAbiParameters([uint48, uint48], [validAfter, validUntil])`. Sessions installed with a `time-frame` policy through the SDK now behave as intended.
