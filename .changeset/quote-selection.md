---
'@rhinestone/sdk': major
---

- `prepareTransaction` returns `quotes: { best, all }` instead of `quote`.
- `signTransaction(prepared, { quote })` lets callers sign a non-default quote from `prepared.quotes.all`.
- `SignedTransactionData.quote` is the selected quote.
