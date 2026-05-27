---
'@rhinestone/sdk': major
---

Align SDK with the orchestrator's new operation model (blanc API version).

- `IntentStatus` reduced to 3 states: `PENDING`, `COMPLETED`, `FAILED`. Removed: `PRECONFIRMED`, `CLAIMED`, `FILLED`, `EXPIRED`.
- `IntentOpStatus` response shape replaced with flat per-chain `operations[]`. Removed: `claims`, `fillTransactionHash`, `fillTimestamp`, `destinationChainId`.
- `TransactionStatus` (returned by `waitForExecution`) now contains `status`, `accountAddress`, and `operations[]` instead of `fill` / `claims`.
- `waitForExecution` no longer accepts the `acceptsPreconfirmations` parameter.
- Removed types: `Claim`, `ClaimStatus`.
- Removed status constants: `INTENT_STATUS_EXPIRED`, `INTENT_STATUS_FILLED`, `INTENT_STATUS_PRECONFIRMED`, `INTENT_STATUS_CLAIMED`.
