---
"@rhinestone/sdk": minor
---

Session claim policies are now keyed on settlement layer. A single declarative `SessionClaimPolicy` authorizes one or more settlement layers via `settlementLayers` (`'across'`, `'relay'`, or `'any'`); the SDK maps each layer to its underlying claim mechanism (Across → Permit2 arbiter, Relay → IntentExecutor) and selects the right one per intent at sign time. Callers describe high-level constraints (destination tokens/recipients, gas tokens, exchange-rate cap, expiry bounds) and never deal with claim mechanisms, layer ids, adapter config bytes, or router addresses.

`SessionClaimPolicy` is an exclusive (discriminated) union: layer-specific constraints are only accepted when that layer is the sole selection. In particular, time bounds (`expiryBounds`/`fillExpiryBounds`) require `settlementLayers: ['across']`, because the Relay/IntentExecutor path has no signed deadline to enforce them against — setting them on a Relay-inclusive or `'any'` policy is a compile error rather than a silent no-op.

Backward compatible: the previous tagged `{ type: 'permit2-claim', ... }` shape (and the exported `Permit2ClaimPolicy` type) are still accepted and behave identically (Across/Permit2 only), so existing arbiter integrations are a drop-in. The tagged shape is deprecated and will be removed in a future major; migrate by replacing `type: 'permit2-claim'` with `settlementLayers: ['across']`.
