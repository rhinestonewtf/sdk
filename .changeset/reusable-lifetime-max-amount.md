---
'@rhinestone/sdk': minor
---

Allow `maxAmount` on a reusable `crossChainPermits` session (one without `oneTimeUse`). There it is a lifetime total per `from` token on the session's chain: the sum of everything the session approves of that token, across every intent it signs and every route it settles through (`ACROSS`, `CCTP`, `ECO_IE`), not a per-intent cap.

- Enabling the session again resets the budget. `account.getSessionDetails` (and `getSessionDetails` from `@rhinestone/sdk/smart-sessions`) reads the session's nonce and enabled state in one call and throws for one that is already enabled, including inside a bundle that adds another chain. It recognises such a session from its actions as well as its new `lifetimeBudget: true` field. Leave it out of the bundle, or pass `{ allowBudgetReset: true }` to sign the reset on purpose. Disabling the session and enabling it again also starts a fresh budget, by the owner's choice.
- Build the session once and store it. A definition that uses `'all'` or names no layers resolves against `GET /chains` and the clock, so rebuilding it can give a different permissionId, and enabling that one starts a new budget beside what the old session has left.
- The budget does not count allowances the account already holds for the token, which the session's routes can still spend: one the owner gave Permit2 or a bridge, or one another session left. Revoke them first for the cap to be the most the session can move. It does not count the `allowFees` calls either, which keep their own caps. Each approve counts in full, so approving the same spender again spends the budget again.
- `ECO_IE`'s `maxFeeBps` floor applies to every intent, so an intent below `maxAmount × (1 − maxFeeBps / 10000)` does not settle through `ECO_IE`.
- Intents still use the whole `maxAmount` as their source-asset cap. The chain refuses a plan that goes over what is left.
- `OFT` and `LZ` still require `oneTimeUse`, because each send pays a native LayerZero fee that `maxAmount` does not bound. `'all'` still drops them from a reusable session.
- A wrapped native `from` leg with `maxAmount` requires `oneTimeUse` (`WRAPPED_NATIVE_LIFETIME_CAP_REQUIRES_ONE_TIME_USE`): its native wrap is capped per call, not over the session.
- `maxAmount` with `fallback` still requires `oneTimeUse` (`PERMIT2_MAX_AMOUNT_REQUIRES_ONE_TIME_USE`). `preClaimOps: 'none'` with a `maxAmount` is refused with `PRE_CLAIM_OPS_NOT_APPLICABLE`, because its claims spend an allowance the cap does not count.
- The `UNCAPPED_ACROSS_ROUTE` warning now asks only for `maxAmount`, and also fires for a permit naming only `ACROSS` that has an uncapped `from` leg beside a capped one. Its message says what bounds such a leg: nothing on that permit, and beside IntentExecutor layers only the chain's `maxAmount` read in that token's raw units.
- Every session that could be built without this keeps its permissionId and enable digest, and `getSessionDetails` signs it exactly as before, with no extra read.
