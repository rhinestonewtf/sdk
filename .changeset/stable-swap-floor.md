---
'@rhinestone/sdk': minor
---

Add an opt-in `stableFloor` to the `swap` session scope (RHI-7883). With it on, every Rhinestone Swapper call must deliver at least `ceil(maxTotal × (1 − slippage))` of the buy token (default 100 bps, or `{ maxSlippageBps }`), while the sell side stays capped cumulatively at `maxTotal`. That bounds the worst rate at floor/cap, so a session key can no longer zero the Swapper's output bound and route the input away — closing RHI-7870 for sessions that opt in.

It requires one sell token, `sell.maxTotal`, both tokens USD stablecoins in the orchestrator's chain catalog, and the Swapper as the only venue. `sdk.createSession` supplies the catalog; the standalone `toSession` takes it as `options.supportedTokens`. The floor is absolute, so a swap much smaller than `maxTotal` cannot meet it. Scopes without `stableFloor` are unchanged, down to the session digest.
