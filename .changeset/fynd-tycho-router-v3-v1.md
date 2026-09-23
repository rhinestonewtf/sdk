---
'@rhinestone/sdk': patch
---

Scope `fynd()` swap sessions to fynd's TychoRouter V3 deployment and its `singleSwap` calldata, in both the direct router call and the Swapper-wrapped one. The router they previously named is paused and fynd no longer fills through it.

A session built with `fynd()` on an earlier v1 version authorises only that router and its old argument layout, so it cannot execute fynd swaps. Re-create it with this version and enable it again.

Backport of the same change on v2.
