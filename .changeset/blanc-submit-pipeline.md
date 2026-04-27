---
'@rhinestone/sdk': major
---

Submit signed intents through the blanc `POST /intents` handshake.

- `submitIntentInternal` now POSTs `{ intentId, signatures, authorizations?, options? }`
  to `/intents` via `Orchestrator.createIntent`.
- The legacy `submitIntent` / `createSignedIntentOp` wrappers and the
  `{ result: { id } }` envelope are gone; the response collapses to
  `{ intentId }`, so `TransactionResult.id` is now a string carrying
  the server-issued intent id.
- `waitForExecution`, `getIntentStatus`, and `splitIntents` route to
  `Orchestrator.getIntent` / `getSplit` respectively.
- `signAuthorizationsInternal` now takes `{ sourceChains, targetChain,
  eip7702InitSignature }` directly, so the intent path can call it
  without synthesizing a full prepared transaction.
