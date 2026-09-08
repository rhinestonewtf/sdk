---
'@rhinestone/sdk': minor
---

Type the bridge refund on `IntentOpStatus`, so a failed cross-chain intent can say where the funds went back to.

The orchestrator serves `refunds: [{ chain, txHash }]` on the alps wire this SDK requests, and `getIntentOpStatus` returns the response body as-is — so the value has always arrived once the orchestrator sends it, and only the type omitted it. Reading it no longer needs a cast. `IntentRefund` is exported.

A refunded intent stays `FAILED`: it did not do what was asked, and the refund says where the money went rather than that it succeeded. The key is **absent** when no refund is known, which is not the same fact as "there was none" — a refund is recorded only where a settlement layer evidences it with a transaction.
