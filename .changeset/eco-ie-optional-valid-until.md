---
'@rhinestone/sdk': minor
---

Accept an `ECO_IE` settlement-scoped permit without `validUntil`, and keep `ECO_IE` under `settlementLayers: 'all'` when `validUntil` is omitted. Without `validUntil` the session pins neither Eco deadline, so an unfilled `ECO_IE` reward has no refund deadline, as nothing else in such a session is time-bound. With `validUntil` nothing changes: it must be at least 7 days ahead, both the route and the reward deadline stay pinned at or under it, and `ECO_IE` is usable only until `validUntil` minus 7 days.
