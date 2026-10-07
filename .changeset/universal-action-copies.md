---
'@rhinestone/sdk': minor
---

Add `SessionDefinition.policyAddresses.universalActionCopies`: optional extra UniversalActionPolicy deployments let an all-AND ArgPolicy split across them (RHI-8045). When it is set, an action's ArgPolicy whose expression only ANDs rules is installed as UniversalActionPolicy configs of up to 16 rules each, in evaluation order, one per deployment, with the same `valueLimitPerUse` on each. This can lower the storage written at enable. An action keeps its ArgPolicy if its expression has an `or` or a `not`, or if there are fewer free deployments than configs. Off until configured: with no copies, sessions encode as before.

- Each copy must be a deployment of the canonical UniversalActionPolicy bytecode on the session's chain. A copy that repeats `universalAction`, another copy, or any other policy address the SDK uses throws.
- `sdk.createSession` reads the code at `universalAction` and at each copy on the session's chain, and throws unless they match.
- `saltMode: 'v1'` with copies throws: a 1.x session has no split policies to reproduce.
