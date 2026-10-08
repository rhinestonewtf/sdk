---
'@rhinestone/sdk': minor
---

Add `sdk.validateCrossChainPermits(definition)` and a standalone `validateCrossChainPermits(definition, { settlement })` in `@rhinestone/sdk/smart-sessions`. Both dry-run `createSession` and do not throw a refusal. They return `{ refusals, access?, settlementCoverage? }`, typed `CrossChainPermitValidation`.

- `refusals` lists every refusal `createSession` would throw, not only the first. Each entry is `{ code, message, permitIndex?, layer?, chainId?, leg? }`. The first entry is the error `createSession` throws, with the same message, and the list is empty only when `createSession` succeeds. The SDK method also checks the UniversalActionPolicy copies' code first, as `createSession` does.
- When nothing is refused, `access` and `settlementCoverage` are what the created session carries: whether the session keeps the intent-execution fallback, and which layers `settlementLayers: 'all'` dropped and why.
- Problems that do not depend on each other are all reported. Within one settlement layer, only the first problem is reported.
- Each refusal has a stable `code`, listed in the exported `CROSS_CHAIN_PERMIT_REFUSAL_CODES`, including the `to.minAmount` floor refusals (`MIN_AMOUNT_NOT_ENFORCEABLE`, `LZ_FLOOR_ON_CCTP_ROUTE`, `ECO_FLOOR_NEEDS_EQUAL_CAPS` and others) and the session window refusals. The errors `createSession` throws now carry the same `code`. Their messages and error classes do not change.
