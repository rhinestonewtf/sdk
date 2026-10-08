---
'@rhinestone/sdk': minor
---

Accept an `ECO_IE` settlement-scoped permit without `validUntil`, and keep `ECO_IE` under `settlementLayers: 'all'` when `validUntil` is omitted. `ECO_IE` now bounds Eco's route and reward deadlines by the session's earliest deadline: the permit's `validUntil`, `oneTimeUse.validUntil`, or a `validUntil` on a permission function or `time-frame` action. That deadline must be at least 7 days ahead, and `ECO_IE` is usable only until it minus 7 days. Only when the session has no deadline at all (no `validUntil` on the permit and none on the session) are both Eco deadlines unpinned, so an unfilled `ECO_IE` reward has no refund deadline.

A session whose permit `validUntil` is later than another deadline on the session now pins Eco's deadlines to the earlier one, so its permission id changes and it must be enabled again; when the earlier one is under 7 days ahead, `ECO_IE` is refused, or dropped under `'all'`. With only a permit `validUntil`, nothing changes.

A `settlementLayers: 'all'` session without a permit `validUntil` now includes `ECO_IE` where it can settle, so its encoding and permission id change and it must be enabled again.
