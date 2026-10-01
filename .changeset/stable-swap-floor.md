---
'@rhinestone/sdk': minor
---

Add an opt-in `stableFloor` to the `swap` session scope (RHI-7883). With it on, every Rhinestone Swapper call must deliver at least `ceil(maxTotal × (1 − slippage))` of the buy token (default 100 bps, or `{ maxSlippageBps }`) while selling at most `maxTotal`, so no call executes below floor/cap. A session key can no longer zero the Swapper's output bound and route the input away — closing RHI-7870 for sessions that opt in. Total sell is bounded by the approve's cumulative spending limit (`maxTotal`) plus any allowance to the Swapper proxy that existed before the session.

It requires one sell token, `sell.maxTotal`, both tokens among the USD stablecoins (6 or 18 decimals) the orchestrator serves for the chain (`/chains` `settlement.usdStablecoins`), and the Swapper as the only venue, so create the session with `sdk.createSession`. It refuses `signing`, `crossChainPermits`, `claimPolicies` and any other action on the sell token, Permit2 or the Swapper (an action on another contract that already holds an allowance on the sell token is not checked), and uses the strict salt so the session never shares a permissionId with an unfloored one. The floor is absolute, so a swap much smaller than `maxTotal` cannot meet it; in practice the session is single-use. Scopes without `stableFloor` are unchanged, down to the session digest.
