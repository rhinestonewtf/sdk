---
'@rhinestone/sdk': major
---

- `prepareTransaction` returns `quotes: { best, all }` instead of `quote`.
- `signTransaction(prepared, { intentId })` lets callers sign a non-default quote from `prepared.quotes.all`.
- `getTransactionMessages(prepared, { intentId })` accepts the same selection so external signers see the route `signTransaction` will sign.
- `SignedTransactionData.quote` is the selected quote.
- `intentId` is required on the options argument; pass an id from `prepared.quotes.all` or omit options entirely to sign the recommended quote.
