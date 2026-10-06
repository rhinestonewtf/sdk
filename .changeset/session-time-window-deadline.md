---
'@rhinestone/sdk': minor
---

Express a session's time window as the one-time-use deadline. `validUntil` on a `permissions` function, on a raw `time-frame` action policy or on a Permit2-layer `crossChainPermits` entry now requires `oneTimeUse` and joins `oneTimeUse.validUntil` as the session deadline (the earliest applies); without `oneTimeUse` it throws when the session is built, and `validAfter` on any of them always throws. To bound a session in time, set `oneTimeUse: { id, validUntil }`. Sessions that set such a window get a different permissionId and enable digest; sessions without one, and `signing` validity windows, are unchanged.

A session enabled earlier with any of these windows cannot be rebuilt with `toSession` after upgrading (it throws, or resolves to a different permissionId): keep and pass the `Session` you stored at enable (for example, to disable it), or disable such sessions before upgrading.
