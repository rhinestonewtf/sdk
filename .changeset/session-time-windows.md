---
'@rhinestone/sdk': minor
---

Enforce session time windows on executions with the new TimeFramePolicy at `0xEAAb79CA50a37514E3Bd2538Aa80ee8cB0eCe9d3`, and accept them without `oneTimeUse`.

- `validUntil` / `validAfter` on a `permissions` function and a raw `time-frame` action policy compile to a time-frame policy on that action.
- A `crossChainPermits` entry's `validUntil` / `validAfter` puts a time-frame policy on every action the permit adds: on a Permit2 layer its approve, wrapped-native `deposit()`, fee calls and pre-claim action (with `fallback`, also the wildcard); on an IntentExecutor layer each layer's calls and, without `oneTimeUse`, the pre-claim action. On a Permit2 layer the claim still bounds the Permit2 deadline by the window, and a `validAfter` also joins the ERC-1271 policies, narrowed with any `signing` window into one entry. A `validAfter` that is not earlier than `validUntil` (on a permit, a permission function, a raw `time-frame` action or `signing`), or two windows on one action or on the ERC-1271 list that do not overlap, is refused, with `VALID_AFTER_EXCEEDS_VALID_UNTIL` where the refusal has a code.
- `oneTimeUse.validUntil` is the one-time-use deadline on its own; other windows no longer shorten it. The `Session.claimPolicies` kept for signing now carry the same Permit2 deadline bound as the installed claim policy (the earlier of the two `validUntil`s). `ECO_IE` pins Eco's deadlines under the earlier of the permit's `validUntil` and `oneTimeUse.validUntil`.
- `signing` validity windows also use the new address. Set `policyAddresses.timeFrame` to `0x0000000000D30f611fA3bf652ac6879428586930` to rebuild a session enabled with the previous one.

Sessions without a window keep their permissionId and enable digest, except a Permit2-layer `crossChainPermits` entry without `maxAmount`, whose permissionId moves: re-enable it, or keep the stored `Session`. A session with any window gets a new permissionId and digest; to disable one enabled earlier, pass the `Session` stored at enable.
