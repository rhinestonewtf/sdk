---
'@rhinestone/sdk': minor
---

Express a session's time window as the one-time-use deadline. To bound a session in time, set `oneTimeUse: { id, validUntil }`: one deadline for the whole session. `validUntil` on a `permissions` function, on a raw `time-frame` action policy or on a Permit2-layer `crossChainPermits` entry is optional, requires `oneTimeUse` and can only shorten that deadline (the earliest applies; there is no per-function deadline); without `oneTimeUse` it throws when the session is built, and `validAfter` on any of them always throws. Sessions that set such a window get a different permissionId and enable digest; sessions without one, and `signing` validity windows, are unchanged.

A session enabled earlier with any of these windows cannot be rebuilt with `toSession` after upgrading (it throws, or resolves to a different permissionId): keep and pass the `Session` you stored at enable (for example, to disable it), or disable such sessions before upgrading.
