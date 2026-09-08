---
'@rhinestone/sdk': minor
---

Export `FYND_CHAIN_IDS` and its `FyndChainId` type from `@rhinestone/sdk/smart-sessions`.

A caller composing venues has to know which chains fynd can serve — `scopeFynd` throws on the rest, and `fynd()` takes no chain, so the set could not be tested for. The only recourse was to copy the list, which then drifts as fynd gains chains.
