---
'@rhinestone/sdk': patch
---

Point `fynd()` swap sessions at PropellerHeads' redeployed TychoRouterV3 on every fynd chain (Ethereum, BNB Chain, Unichain, Polygon, Base, Plasma, Arbitrum), in both the direct router call and the Rhinestone-Swapper-wrapped one. The router ABI is unchanged.

A session built with `fynd()` (or `rhinestoneSwap({ route: 'fynd' })`) on an earlier version authorises the previous router deployment, which no longer executes fynd swaps. Re-create it with this version. This changes the session's digest on those chains.
