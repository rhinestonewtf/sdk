---
'@rhinestone/sdk': minor
---

Add `SessionDefinition.crossChainPermits` (`CrossChainPermissionInput`) to authorise session keys to move funds across chains via Permit2 arbiter settlement. Pick settlement layers (`SAME_CHAIN` / `ECO` / `ACROSS`, or all by default); bridge-to-self is enforced unless `allowRecipientNotAccount` is set.
