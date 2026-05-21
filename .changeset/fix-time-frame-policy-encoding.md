---
'@rhinestone/sdk': patch
---

Fix `getPolicyData('time-frame')` to match the deployed `TimeFramePolicy` contract. Now emits `encodePacked(['uint128','uint128'], [validUntil, validAfter])` — a 32-byte `bytes16 validUntil || bytes16 validAfter` payload — instead of the previous 12-byte `uint48`/`uint48` packing (reverted on `initializeWithMultiplexer`) and the intermediate 64-byte ABI-encoded variant (init succeeded but wrote zeros so the policy always reverted at use time). Sessions installed with a `time-frame` policy through the SDK now behave as intended.
