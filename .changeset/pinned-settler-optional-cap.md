---
'@rhinestone/sdk': minor
---

Allow an optional `maxSpend` alongside a pinned 0x Settler, and export `ZEROX_CHAIN_IDS` from `@rhinestone/sdk/smart-sessions`.

`ZeroExPinnedOptions.maxSpend` was typed `never`, so pinning the Settler and setting a spend ceiling were mutually exclusive. The pin is what bounds a compromised session key — a cap is mandatory only on the `anySettler` variant, where it is the sole bound — but a caller can still want a ceiling on its own terms, and `scopeZeroEx` already applied `ctx.cap` on both paths.

`ZEROX_CHAIN_IDS` joins `FYND_CHAIN_IDS`: resolving a Settler means knowing which chains 0x serves first, and the alternative is duplicating the list downstream where it drifts.
