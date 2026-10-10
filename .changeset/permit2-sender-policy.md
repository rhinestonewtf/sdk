---
'@rhinestone/sdk': minor
---

Let a scoped Permit2-route session be reusable and keep its pre-claim calls. A session whose Permit2-layer permit sets neither `oneTimeUse` nor `preClaimOps: 'none'`, and that sets no `fallback`, now gets Permit2SenderPolicy (`0xb590a7409de9e9f2A42B56CB62C1f7bA5ea0f959`, the same address for production and development) on its ERC-1271 list, after its claim policy and with empty init data. That policy accepts a claim signature only when Permit2 presents it, so the session's pre-claim calls (the Permit2 approve and, with `allowFees`, the fee calls) are checked as executions, which these sessions already sign for.

- Such a definition was refused with `PERMIT2_ROUTE_NEEDS_BOUND`; it now builds on the chains the policy is deployed on. It is still refused on a chain without it, such as Avalanche or Robinhood Chain, and the refusal names that chain.
- Sessions with `oneTimeUse`, `preClaimOps: 'none'` or `fallback` are unchanged, permissionId and enable digest included.
- A `maxAmount` on such a permit still needs `oneTimeUse` (`PERMIT2_MAX_AMOUNT_REQUIRES_ONE_TIME_USE`), so a reusable session's Permit2 approve is uncapped and it gets no wrapped native `deposit()`.
