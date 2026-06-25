---
'@rhinestone/sdk': minor
---

Export `toCrossChainPermissionInput` from `@rhinestone/sdk/smart-sessions`, which converts a resolved `CrossChainPermit` (unix-seconds deadlines, `recipientIsAccount`) back into the `CrossChainPermissionInput` shape accepted by `SessionDefinition.crossChainPermits` (`Date` deadlines, `allowRecipientNotAccount`). Useful when a permit was persisted in resolved form and has to be re-supplied as session input.
