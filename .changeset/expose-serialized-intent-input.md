---
'@rhinestone/sdk': minor
---

Expose `SerializedIntentInput`, the wire form of `IntentInput` with `bigint` fields as decimal strings. Sponsorship servers can type their request body with it instead of re-deriving the mapping, and it now types `PreparedTransactionData.intentInput` and the JWT auth `getIntentExtensionToken` callback in place of `unknown`.
