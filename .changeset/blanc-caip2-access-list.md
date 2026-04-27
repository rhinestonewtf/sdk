---
'@rhinestone/sdk': major
---

Encode `accountAccessList` and `auxiliaryFunds` chain ids as CAIP-2 on the wire.

The orchestrator's blanc layer expects CAIP-2 (`eip155:N`) chain ids
across the request body; the SDK was passing these two fields through
verbatim with raw integer chain ids, so any caller that supplied them
got a wire-level rejection. The fix translates inside the client only —
consumers keep using numeric chain ids on the SDK surface.
