---
'@rhinestone/sdk': minor
---

A `swap` scope takes optional `validUntil` / `validAfter`, with the same meaning as a `crossChainPermits` window: `validAfter <= t < validUntil` in whole seconds, `validAfter` rounded up. The window is a time-frame policy on every action the scope adds (each sell token's `approve` and each venue's swap call), so the session stops swapping when it closes, independently of any permit window on the same session. Like an action window, it bounds an ERC-1271 signing surface outside claim policies.

It is refused as a permit window is: `VALID_UNTIL_NOT_IN_FUTURE`, `VALID_AFTER_INVALID`, `VALID_AFTER_EXCEEDS_VALID_UNTIL`, and `TIME_FRAME_POLICY_UNAVAILABLE` on a chain without the TimeFramePolicy unless `policyAddresses.timeFrame` is set. A swap scope without a window builds the same session data as before.
