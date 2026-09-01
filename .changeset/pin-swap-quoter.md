---
'@rhinestone/sdk': minor
---

Add `quoters` to `Transaction`, restricting which swap venues may serve an intent's swaps, along with the public `SwapQuoter` and `SwapQuoterFilter` types. A session scoped to specific venues via `swap.via` now derives the matching pin automatically, so the venue is stated once; across a per-chain session set the pin is the intersection of every session's venues.
