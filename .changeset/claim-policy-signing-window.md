---
'@rhinestone/sdk': minor
---

Allow a signing validity window alongside claim policies, and deprecate `claimPolicies` in favour of `crossChainPermits`.

A session declaring `claimPolicies` previously rejected any `signing` config, because the claim policies take over the ERC-1271 list. That is still right for `scoped` and `disabled`: both rewrite `allowedERC7739Content`, which is the gate the claim policy is reached through, so the declared policy would never be consulted — and since the list is an AND, a scoped content could not be signed anyway, because the claim policy rejects every digest that is not its own.

A validity window is different. `{ mode: 'unrestricted', validAfter, validUntil }` lowers to a `TimeFramePolicy`, which ANDs with the claim policies and leaves the content gate alone, so it is now kept: the session may authorize Permit2 claims, within a window. Without a window the signing policy is a sudo entry that cannot weaken the AND but would read as a capability the session no longer has, so it is still dropped rather than carried.

`SessionDefinition.claimPolicies` is now `@deprecated` in favour of `crossChainPermits`, which expands to the same claim policy plus the spending-limit and timeframe guardrails, takes `Date`s rather than raw deadlines, defaults to bridge-to-self instead of leaving the recipient open, and picks the enforcement surface per settlement layer — a Permit2 arbiter layer compiles to a claim policy, while an IntentExecutor layer compiles to argument-pinned actions, which a claim policy does not bind at all. It stays exported as the escape hatch for pinning `spenders` to an arbiter outside the bundled allow-set.
