---
"@rhinestone/sdk": minor
---

Add `createCrossChainPermission()` and `SessionDefinition.crossChainPermits` for authorising session keys to move funds across chains via Permit2 arbiter settlement. Each permit expands into a `Permit2ClaimPolicy` (claim-side) plus optional `SpendingLimitsPolicy` / `TimeFramePolicy` entries on the fallback action — the claim policy itself doesn't enforce amounts or expiry on-chain. Devs select settlement layers (`SAME_CHAIN` / `ECO` / `ACROSS`) and the SDK resolves them to the canonical Permit2 arbiter addresses from `@rhinestone/shared-configs`; omitting (or passing `[]`) expands to the union of every supported layer. Bridge-to-self (`recipientIsAccount`) is enforced by default — opt out explicitly with `allowRecipientNotAccount: true`.
