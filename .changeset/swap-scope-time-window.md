---
'@rhinestone/sdk': minor
---

Add `validUntil` / `validAfter` to a session's `swap` scope, so the session swaps only inside that window: `validAfter <= t < validUntil` in whole seconds, with `validAfter` rounded up, as for a `crossChainPermits` window. The window covers each sell token's `approve` and each venue's swap call, and nothing else in the session; a permit window on the same session stays on the permit's actions.

A windowed swap scope is salted as with `saltMode: 'strict'` (unless `saltMode` is `'v1'`), so it gets its own permissionId and is never folded into another enabled session. It is refused like a permit window: `VALID_UNTIL_NOT_IN_FUTURE`, `VALID_AFTER_INVALID`, `VALID_AFTER_EXCEEDS_VALID_UNTIL`, and `TIME_FRAME_POLICY_UNAVAILABLE` on a chain without the TimeFramePolicy unless `policyAddresses.timeFrame` is set. A swap scope without a window builds the same session as before.
