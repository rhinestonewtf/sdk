---
'@rhinestone/sdk': minor
---

Add `sdk.validateSession(definition)`, a dry run of `createSession`. It returns every refusal `createSession` would throw for a session definition, not only the first, and returns `{ refusals, access?, settlementCoverage? }` (typed `SessionValidation`) instead of throwing a refusal.

- It makes the same reads as `createSession` (the UniversalActionPolicy copies' code, then `GET /chains`) and runs the same resolution. The first refusal is the error `createSession` throws, with the same message, and `refusals` is empty only when `createSession` succeeds. A failed read throws, as it does in `createSession`.
- Each refusal is `{ code, message, permitIndex?, layer?, chainId?, leg? }`. Problems that do not depend on each other are all reported. Within one settlement layer, only the first problem is reported.
- When nothing is refused, `access` and `settlementCoverage` are what the created session carries: whether it keeps the wildcard fallback, and which layers `settlementLayers: 'all'` dropped and why.
- Each refusal's `code` is stable. The codes are listed, with what each means, in `SESSION_REFUSAL_CODES`, exported from `@rhinestone/sdk/smart-sessions`. A refusal without a code of its own has `SESSION_REFUSED`.
- `@rhinestone/sdk/smart-sessions` also exports a standalone `validateSession(definition, { settlement, wrappedNativeToken, useDevContracts })`, which runs the same resolution without network calls, and the `SettlementCatalog`, `SettlementAddresses` and `SessionValidationOptions` types. It does not read the copies' code or check `/chains` for a wrapped-native token.
- The `SessionValidation`, `SessionRefusal` and `SessionRefusalCode` types are exported from the package root and from `@rhinestone/sdk/smart-sessions`.
