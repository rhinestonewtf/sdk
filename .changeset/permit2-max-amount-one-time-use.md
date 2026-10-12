---
'@rhinestone/sdk': patch
---

A Permit2-route permit (`settlementLayers: ['ACROSS']`, or any permit on a session with `fallback`) that sets `maxAmount` on a `from` leg now requires `oneTimeUse`. Set `oneTimeUse`, or drop `maxAmount`. Sessions without `maxAmount`, with `oneTimeUse`, or with IntentExecutor-layer permits are unchanged.
