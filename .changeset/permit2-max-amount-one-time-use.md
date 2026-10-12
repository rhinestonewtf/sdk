---
'@rhinestone/sdk': patch
---

A Permit2-route permit on a session with `fallback` that sets `maxAmount` on a `from` leg now requires `oneTimeUse` (`PERMIT2_MAX_AMOUNT_REQUIRES_ONE_TIME_USE`). Set `oneTimeUse`, drop `maxAmount`, or drop `fallback`. Sessions without `maxAmount`, with `oneTimeUse`, or without `fallback` are unchanged.
