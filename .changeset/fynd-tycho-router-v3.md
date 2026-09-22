---
'@rhinestone/sdk': patch
---

Scope `fynd()` swap sessions to fynd's TychoRouter V3 deployment and its `singleSwap` calldata, in both the direct router call and the Swapper-wrapped one. The router they previously named is paused and fynd no longer fills through it.

A session built with `fynd()` on an earlier version authorises only that router and its old argument layout, so it cannot execute fynd swaps. Re-create it with this version and enable it again.
