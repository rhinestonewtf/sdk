---
'@rhinestone/sdk': minor
---

Scope Permit2-route sessions like settlement-scoped ones. A session whose `crossChainPermits` entry names `ACROSS` or `SAME_CHAIN`, or omits `settlementLayers`, no longer gets the wildcard fallback action; `access.kind` is now `'scoped'`.

- The session may call only `approve(Permit2, amount)` on each `from` token on its chain, capped at the largest `maxAmount` of that token's legs, plus its claim policy and the `oneTimeUse` burn. A declared approve on the same token takes Permit2 as one more spender when both only pin the spender; any other overlap is refused with `PERMIT2_APPROVE_CONFLICT`.
- `allowFees` now applies to these permits too, adding the app-fee transfer and paymaster calls. Without it, only sponsored intents without an app fee settle. It needs the fee addresses `sdk.createSession` reads from `GET /chains`.
- A permit without a `from` token on the session's chain is refused with `PERMIT2_ROUTE_NEEDS_FROM`.
- A permit naming the retired Permit2 `ECO` arbiter is refused with `RETIRED_PERMIT2_LAYER`, with or without `fallback`; use `ECO_IE`. Omitting `settlementLayers` now admits only the `SAME_CHAIN` and `ACROSS` arbiters.
- Intents signed with a session that admits `ACROSS` are pinned to `settlementLayers: { include: ['ACROSS'] }`; an explicit filter can only narrow it. A `SAME_CHAIN`-only session adds no filter.
- `restrictToActions` can now be combined with such a permit.
- Add `fallback: 'intentExecution'` to keep the previous wildcard action (calls to targets on Rhinestone's intent-execution allow-list, with the permit's spending limit), or `fallback: 'sudo'` for a wildcard that may call any contract with any arguments. Either one reports `access.kind: 'open'` and keeps the previous intent filter. `fallback` on any other session is refused with `FALLBACK_WITHOUT_PERMIT2_PERMIT`.
- `ALLOW_FEES_ONLY_INTENT_EXECUTOR` is no longer raised. Sessions holding raw `claimPolicies` are unchanged.

The permissionId and enable digest of every Permit2-route session change, so a session built with an earlier version must be enabled again.
