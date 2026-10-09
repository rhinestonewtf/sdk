---
'@rhinestone/sdk': patch
---

A Permit2-route permit (`SAME_CHAIN`, `ACROSS`, or `settlementLayers` omitted) with a recipient other than the account now needs `allowRecipientNotAccount`, as IntentExecutor layers already did. Before, it resolved into a session that could not settle. It is refused with `RECIPIENT_NOT_ACCOUNT`, or `RECIPIENT_ANY_NOT_ALLOWED` for `'any'`, by `validateSession` and `createSession`. A recipient equal to the account, in any casing, still needs no opt-out.
