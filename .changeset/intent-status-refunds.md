---
'@rhinestone/sdk': minor
---

Surface the bridge refund on an intent's status, so a failed cross-chain intent can say where the funds went back to.

The orchestrator reports `refunds: [{ chain, txHash }]` when a settlement layer returns the funds to the account instead of delivering them, but the SDK dropped it: `mapIntentStatusFromWire` builds an explicit object and the field was not among its keys. It now reaches `IntentStatus`, `TransactionStatus` and the value `waitForExecution` resolves to, with the new `IntentRefund` type exported.

It also rides `IntentFailedError.context`, which is the only path it has for the case it exists to answer: a refunded intent is still `FAILED`, so `waitForExecution` throws rather than returning a status, and a caller on that path would otherwise never see the refund.

The key stays **absent** when the orchestrator knows of no refund, rather than defaulting to `[]`. A refund is recorded only where a layer evidences it with a transaction, so presence is a fact and absence is not a claim — defaulting would report that funds were kept on an intent we simply have no refund for yet.
