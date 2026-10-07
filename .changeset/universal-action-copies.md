---
'@rhinestone/sdk': patch
---

Add `SessionDefinition.policyAddresses.universalActionCopies`: optional extra UniversalActionPolicy deployments let an all-AND ArgPolicy split across them (RHI-8045). When it is set, an action's ArgPolicy whose expression only ANDs rules is installed as UniversalActionPolicy configs of up to 16 rules each, in evaluation order, one per deployment, with the same `valueLimitPerUse` on each. This costs less gas to enable. An action keeps its ArgPolicy if its expression has an `or` or a `not`, or if there are fewer free deployments than configs. The copies must differ from `universalAction` and from each other. Off until configured: with no copies, sessions encode as before.
