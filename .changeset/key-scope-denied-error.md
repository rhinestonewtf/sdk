---
'@rhinestone/sdk': minor
---

Surface orchestrator `KEY_SCOPE_DENIED` responses as a typed `KeyScopeDeniedError` (subclass of `ForbiddenError`) carrying the failed `scope`, the `required` level, and the key's `actual` level. Integrators can now distinguish "scoped out" from "invalid key" without losing the structured payload.
