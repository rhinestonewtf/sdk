---
'@rhinestone/sdk': minor
---

Update SmartSession action policy singleton addresses to the new canonical V2 deployments (`SudoPolicy`, `UniversalActionPolicy`, `UsageLimitPolicy`, `ValueLimitPolicy`, `TimeFramePolicy`, `ERC20SpendingLimitPolicy`) and add `ArgPolicy` support for expression-tree rules.

- Add the `arg-policy` policy variant (`ArgPolicyExpression` AST with `rule` / `not` / `and` / `or` nodes) for action rules that need disjunction or negation. `universal-action` stays available for plain AND-of-rules.
- Extend the `permissions` builder used by `toSession`: `params` constraints accept `{ anyOf: [v1, v2, ...] }` to allowlist values (compiles to `arg-policy`); per-function sugar fields `maxUses`, `validUntil`, `validAfter`, `valueLimit`, and `spendingLimit` map 1:1 to their policy types, with `valueLimit` type-gated to `payable` functions and `spendingLimit` type-gated to ERC-20 transfer-shaped ABIs.
- Add `SessionDefinition.policyAddresses` — a partial override map (`sudo`, `universalAction`, `argPolicy`, `spendingLimits`, `timeFrame`, `usageLimit`, `valueLimit`) for backwards compatibility with accounts that already enabled sessions against the previous policy deployments. Defaults to the new V2 addresses.
- Fix `bytesN` (N<32) reference values in `permissions`: pre-pad right so the encoded `bytes32` matches Solidity calldata alignment instead of being read at the wrong end of the word.
