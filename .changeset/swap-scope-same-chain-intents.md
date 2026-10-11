---
'@rhinestone/sdk': patch
---

Same-chain intents on a session with a `crossChainPermits` entry and a `swap` scope are now signed against the swap scope instead of being refused: they are funded only from the swap's sell tokens on the session's chain, each capped at `sell.maxTotal` (with several sell tokens the on-chain cap is shared, so a plan spending more than it across them reverts), and an explicit `sourceAssets` can only narrow that. A session without a `swap` scope still refuses them.
