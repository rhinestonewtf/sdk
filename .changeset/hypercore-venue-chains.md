---
'@rhinestone/sdk': minor
---

Address HyperCore by delivery venue. `hyperCoreMainnet` is replaced by `hyperCoreSpot` and `hyperCorePerp`, and the `tokenRequests[].balance` flag is removed — the venue a deposit credits (the recipient's spot wallet or the default perp dex's margin account) is now the destination you pass as `targetChain`. It was an optional field that the SDK dropped while rebuilding the intent, so callers asking for spot were silently credited to perp margin. A chain id cannot be dropped that way.

Released as a minor despite removing public exports: HyperCore has never carried an external client's intent (every one in prod history came from two internal projects), so the removal is breaking on paper and inert in practice. A caller that does reference either symbol gets a compile error naming its replacement, not a silent behaviour change.
