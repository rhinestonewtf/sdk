---
"@rhinestone/sdk": major
---

**BREAKING**: Align SDK with the orchestrator's new operation model (blanc API version).

### Breaking changes

- **`IntentStatus`** reduced to 3 states: `PENDING`, `COMPLETED`, `FAILED`.
  Removed: `PRECONFIRMED`, `CLAIMED`, `FILLED`, `EXPIRED`.
- **`IntentOpStatus`** response shape replaced with flat per-chain `operations[]`.
  Removed: `claims`, `fillTransactionHash`, `fillTimestamp`, `destinationChainId`.
- **`TransactionStatus`** (returned by `waitForExecution`) now contains `status`, `accountAddress`, and `operations[]` instead of `fill` / `claims`.
- **`waitForExecution`**: removed the `acceptsPreconfirmations` parameter.
- **Removed types**: `Claim`, `ClaimStatus`.
- **Removed status constants**: `INTENT_STATUS_EXPIRED`, `INTENT_STATUS_FILLED`, `INTENT_STATUS_PRECONFIRMED`, `INTENT_STATUS_CLAIMED`.
- **API version** bumped to `2026-04.blanc`.

### New types

- `OperationStatus`: `'PENDING' | 'COMPLETED' | 'FAILED'`
- `FailureReason`: `'EXPIRED' | 'REVERTED' | 'RELAYER_FAILURE'`
- `ChainOperation`: discriminated union with one operation per chain
