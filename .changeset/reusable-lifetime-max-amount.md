---
'@rhinestone/sdk': minor
---

Allow `maxAmount` on a reusable `crossChainPermits` session (one without `oneTimeUse`). There it is a lifetime total per `from` token on the session's chain: the sum of everything the session approves of that token, across every intent it signs and every route it settles through (`ACROSS`, `CCTP`, `ECO_IE`), not a per-intent cap.

- The budget does not count an allowance the account already holds, whether the owner gave it or another session left it, nor the `allowFees` calls, which keep their own caps. Each approve counts in full, so approving the same spender again spends the budget again. Only the owner enabling the same session again resets the budget.
- `ECO_IE`'s `maxFeeBps` floor applies to every intent, so an intent below `maxAmount × (1 − maxFeeBps / 10000)` does not settle through `ECO_IE`.
- Intents still use the whole `maxAmount` as their source-asset cap. The chain refuses a plan that goes over what is left.
- `OFT` and `LZ` still require `oneTimeUse`, because each send pays a native LayerZero fee that `maxAmount` does not bound. `'all'` still drops them from a reusable session.
- `maxAmount` with `fallback` still requires `oneTimeUse` (`PERMIT2_MAX_AMOUNT_REQUIRES_ONE_TIME_USE`). `preClaimOps: 'none'` with a `maxAmount` is refused with `PRE_CLAIM_OPS_NOT_APPLICABLE`, because its claims spend an allowance the cap does not count.
- The `UNCAPPED_ACROSS_ROUTE` warning now asks only for `maxAmount`.
- Every session that could be built without this keeps its permissionId and enable digest.
