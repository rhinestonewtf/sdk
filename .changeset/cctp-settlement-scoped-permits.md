---
'@rhinestone/sdk': minor
---

Add settlement-scoped cross-chain permits, starting with CCTP (RHI-7826). A `crossChainPermits` entry with `settlementLayers: ['CCTP']` compiles to argument-pinned actions instead of a Permit2 claim policy:

- The session is restricted to `USDC.approve(TokenMessengerV2)` and `TokenMessengerV2.depositForBurnWithHook`, with the `from` token, each `to` chain's CCTP domain paired with its recipient, a zero `destinationCaller` and `maxAmount` (cumulative) pinned in the calldata. `validAfter`/`validUntil` apply to each action.
- The recipient defaults to the account, so the session definition needs `account`. Another recipient, or `'any'`, requires `allowRecipientNotAccount`.
- `maxAmount` requires `oneTimeUse`, so the cap is a true total. Such a permit cannot be combined with `SAME_CHAIN`, `ECO` or `ACROSS`, with another permit, or with `claimPolicies`.
- Only sponsored intents without an app fee can settle through it: the paymaster and fee-carve calls are not authorised.
- Intents signed with the session are limited to its layers (`settlementLayers: { include: ['CCTP'] }`); an explicit filter can only narrow it.

Permits that name only `SAME_CHAIN`, `ECO` or `ACROSS` are unchanged.
