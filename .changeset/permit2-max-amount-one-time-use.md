---
'@rhinestone/sdk': patch
---

A Permit2-route permit (`SAME_CHAIN`, `ECO`, `ACROSS`, or `settlementLayers` omitted) that sets `maxAmount` on a `from` leg now requires `oneTimeUse`. Set `oneTimeUse`, or drop `maxAmount`. Sessions without `maxAmount`, with `oneTimeUse`, or with IntentExecutor-layer permits are unchanged.
