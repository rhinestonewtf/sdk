---
'@rhinestone/sdk': major
---

Submit signed intents through the blanc `POST /intents` handshake.

`submitIntentInternal` now builds an `IntentSubmitRequestInternal`
(`{ intentId, signatures: { origin, destination, targetExecution? },
authorizations?, options? }`) and calls `Orchestrator.createIntent`.
The legacy `submitIntent` / `createSignedIntentOp` wrappers and the
`{ result: { id } }` envelope are gone — the response collapses to
`{ intentId }`, and `TransactionResult.id` is now a `string` carrying
the server-issued intent id.

`waitForExecution` and `getIntentStatus` poll `Orchestrator.getIntent`,
and `RhinestoneSDK.getIntentStatus` / `splitIntents` route to
`getIntent` / `getSplit` respectively. `signAuthorizationsInternal` now
takes the `{ sourceChains, targetChain, eip7702InitSignature }` context
directly so the intent path can call it without synthesizing a full
prepared transaction.
