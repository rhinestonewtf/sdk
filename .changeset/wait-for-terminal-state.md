---
'@rhinestone/sdk': major
---

- `account.waitForExecution` now polls until the intent reaches a terminal state (`COMPLETED` or `FAILED`), with no SDK-side deadline (previously capped at 3.5 minutes). The orchestrator handles expiry internally and surfaces it as `FAILED`.
- Removed the `IntentStatusTimeoutError` class — expiry now surfaces as `IntentFailedError` (inspect `operations[].failureReason` for the cause).
- Removed the `expiresAt` field from `TransactionResult`.
- Narrowed `SettlementLayerFilter` to `CrossChainSettlementLayer[]` (`ACROSS | ECO | RELAY | OFT | NEAR | RHINO | CCTP`) — `SAME_CHAIN` and `INTENT_EXECUTOR` are picked by the orchestrator and were never accepted in the filter at runtime.
