---
'@rhinestone/sdk': minor
---

Add settlement-scoped cross-chain permits, starting with CCTP (RHI-7826). A `crossChainPermits` entry with `settlementLayers: ['CCTP']` compiles to argument-pinned actions instead of a Permit2 claim policy:

- CCTP moves only native USDC, so the `from` token and every `to` token must be USDC on its chain, or the permit throws. Each chain's USDC, CCTP domain and TokenMessengerV2 come from the orchestrator's `GET /chains` `settlement` block.
- The session is restricted to `USDC.approve(TokenMessengerV2)` and `TokenMessengerV2.depositForBurnWithHook`, with the `from` token, each `to` chain's CCTP domain paired with its recipient, a zero `destinationCaller` and `maxAmount` (cumulative) pinned in the calldata.
- The recipient defaults to the account, so the session definition needs `account`. Another recipient, or `'any'`, requires `allowRecipientNotAccount`.
- It must name its `to` chains (an unpinned domain lets a burn go where the recipient cannot mint). `maxAmount` requires `oneTimeUse`, so the cap is a true total. It cannot be combined with `SAME_CHAIN`, `ECO` or `ACROSS`, with another permit, with `claimPolicies`, with `fillDeadline`, or with a `signing` mode other than `disabled`.
- Only sponsored intents without an app fee can settle through it: the paymaster and fee-carve calls are not authorised.
- Intents signed with the session are limited to its layers (`settlementLayers: { include: ['CCTP'] }`); an explicit filter can only narrow it.

Permits that name only `SAME_CHAIN`, `ECO` or `ACROSS` are unchanged.

`getArbitersForSettlementLayers` now throws on a layer with no Permit2 arbiter instead of returning an empty (any-arbiter) list.
