---
'@rhinestone/sdk': patch
---

Fix `getPolicyData('time-frame')` to match the deployed `TimeFramePolicy` contract. Now emits `encodePacked(['uint128','uint128'], [validUntil, validAfter])` — a 32-byte `bytes16 validUntil || bytes16 validAfter` payload. The previous 64-byte `encodeAbiParameters([uint48, uint48], …)` (shipped in 1.6.3) succeeded at `initializeWithMultiplexer` but wrote a zero config, so every later policy check reverted with `PolicyNotInitialized`. Sessions installed with a `time-frame` policy through the SDK now behave as intended.
