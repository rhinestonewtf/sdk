---
'@rhinestone/sdk': major
---

- `account.waitForExecution` now polls until the intent reaches a terminal state (`COMPLETED` or `FAILED`), without an SDK-side deadline. The previous `expiresAt`-based timeout proved unreliable for some flows (e.g. intent executor), where the quote `expiresAt` doesn't reflect the actual fill deadline. The orchestrator handles expiry internally and surfaces it as `FAILED`.
- Removed the `IntentExpiredError` class — expiry now surfaces as `IntentFailedError` (inspect `operations[].failureReason` for the cause).
- Removed the `expiresAt` field from `TransactionResult`.
- Narrowed `SettlementLayerFilter` to `CrossChainSettlementLayer[]` (`ACROSS | ECO | RELAY | OFT | NEAR | RHINO | CCTP`) — `SAME_CHAIN` and `INTENT_EXECUTOR` are picked by the orchestrator and were never accepted in the filter at runtime.
