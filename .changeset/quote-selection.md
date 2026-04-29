---
'@rhinestone/sdk': major
---

- `prepareTransaction` returns `quotes: { best, all }` instead of `quote`.
- `signTransaction(prepared, { quote })` lets callers sign a non-default quote from `prepared.quotes.all`.
- `getTransactionMessages(prepared, { quote })` accepts the same selection so external signers see the route `signTransaction` will sign.
- `SignedTransactionData.quote` is the selected quote.
