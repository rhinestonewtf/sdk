---
'@rhinestone/sdk': minor
---

Deprecate `SessionDefinition.claimPolicies` in favour of `crossChainPermits`, which expands to the same claim policy plus the spending-limit and timeframe guardrails, takes `Date`s rather than raw deadlines, and defaults to bridge-to-self instead of leaving the recipient open. It also picks the enforcement surface per settlement layer: a Permit2 arbiter layer compiles to a claim policy, an IntentExecutor layer to argument-pinned actions, and a claim policy does not bind an IntentExecutor route. `claimPolicies` stays exported as the escape hatch for pinning `spenders` to an arbiter outside the bundled allow-set.
