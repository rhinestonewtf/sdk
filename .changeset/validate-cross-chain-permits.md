---
'@rhinestone/sdk': minor
---

Add `sdk.validateCrossChainPermits(definition)` and a standalone `validateCrossChainPermits(definition, { settlement })` in `@rhinestone/sdk/smart-sessions`. Both return every refusal `createSession` would throw for a session definition, not only the first, and do not throw.

- Each entry is `{ code, message, permitIndex?, layer?, chainId?, leg? }`. The first entry is the error `createSession` throws, with the same message. The list is empty only when `createSession` succeeds.
- Problems that do not depend on each other are all reported. Within one settlement layer, only the first problem is reported.
- Each refusal has a stable `code`, listed in the exported `CROSS_CHAIN_PERMIT_REFUSAL_CODES`. The errors `createSession` throws now carry the same `code`. Their messages and error classes do not change.
