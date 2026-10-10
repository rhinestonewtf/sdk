---
'@rhinestone/sdk': minor
---

Session time windows use the TimeFramePolicy at `0xEAAb79CA50a37514E3Bd2538Aa80ee8cB0eCe9d3`, which holds a window on actions and ERC-1271 checks, and no longer need `oneTimeUse`. A window is `validAfter <= t < validUntil` in whole seconds, with `validAfter` rounded up.

- `validUntil` / `validAfter` on a `permissions` function and a raw `time-frame` action policy compile to a time-frame policy on that action. While any action has one, an ERC-1271 signing surface outside claim policies (the default unrestricted one, or a `signing` mode) is bounded by the time the windows allow together, narrowed by a `signing` window.
- A `crossChainPermits` entry's `validUntil` / `validAfter` puts a time-frame policy on every action the permit adds: on a Permit2 layer its approve, wrapped-native `deposit()`, fee calls and pre-claim action (with `fallback`, also the wildcard); on an IntentExecutor layer each layer's calls and, without `oneTimeUse`, the pre-claim action. On a Permit2 layer the claim accepts a Permit2 deadline from `validAfter` to 1 second before `validUntil`, and a `validAfter` also joins the ERC-1271 policies, narrowed with any `signing` window into one entry.
- The policy is listed per chain as it is deployed. On a chain without it, an action window is refused with `TIME_FRAME_POLICY_UNAVAILABLE` unless `policyAddresses.timeFrame` is set, and a `signing` window keeps the previous deployment `0x0000000000D30f611fA3bf652ac6879428586930`, as before.
- A window that leaves no whole second is refused with `VALID_AFTER_EXCEEDS_VALID_UNTIL`, a `validAfter` that is not a valid `Date` with `VALID_AFTER_INVALID` (`signing` throws for both).
- `oneTimeUse.validUntil` is the one-time-use deadline on its own; other windows no longer shorten it. The `Session.claimPolicies` kept for signing carry the same Permit2 deadline bound as the installed claim policy. `ECO_IE` pins Eco's deadlines under the earlier of the permit's `validUntil` and `oneTimeUse.validUntil`.

Sessions without a window keep their permissionId and enable digest, except a Permit2-layer `crossChainPermits` entry without `maxAmount`, whose permissionId moves: re-enable it, or keep the stored `Session`. A session with an action window gets a new permissionId and digest. A session enabled earlier with a window keeps the policy it was enabled with: to rebuild it, for example to disable it, pass the `Session` stored at enable, or set `policyAddresses.timeFrame` to the previous deployment.
