---
'@rhinestone/sdk': patch
---

Settlement-scoped sessions (a `crossChainPermits` entry naming an IntentExecutor layer: `CCTP`, `OFT`, `ECO_IE`, `LZ` or `SAME_CHAIN_IE`) now always get the strict salt, as `oneTimeUse` and `stableFloor` sessions already do. Without `oneTimeUse` or `saltMode: 'strict'`, such a session was salted with `zeroHash`, so it shared a permissionId with the signer's plain session and `enable` merged the two, leaving the plain session's actions authorised beside the scoped ones.

- A settlement-scoped session built without `oneTimeUse` or `saltMode` (or with `saltMode: 'none'`) moves its permissionId and digest, and must be enabled again.
- One that already had `oneTimeUse` or `saltMode: 'strict'` is unchanged.
- `saltMode: 'v1'` on a settlement-scoped session now throws.
- Sessions without a settlement scope are unchanged.
