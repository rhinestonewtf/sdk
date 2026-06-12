---
'@rhinestone/sdk': minor
---

Update SmartSession policy singleton addresses to the canonical vanity deployments from `rhinestonewtf/yeet#172` and `#174` (Safe Singleton Factory, leading-zero prefixes): `SudoPolicy`, `TimeFramePolicy`, `UsageLimitPolicy`, `ValueLimitPolicy`, `UniversalActionPolicy`, `ERC20SpendingLimitPolicy`.

Add `arg-policy` to the `Policy` union — the expression-tree successor to `universal-action`. Accepts an `ArgPolicyExpression` AST (`rule` / `not` / `and` / `or`); compiled internally to the bit-packed `uint256[]` node layout expected by `ArgPolicy` (`0x0000000000167edE64D8751daACDdC0312565a73`). Use when a session needs disjunction; plain AND-of-rules stays on `universal-action` (cheaper init).

Extend `definePermissions` with `anyOf` constraint form: `{ anyOf: [v1, v2, ...] }` on a param compiles to an OR of EQUAL rules. When any param uses `anyOf`, the whole function emits `arg-policy`; otherwise it stays on `universal-action` for compatibility.

Add per-function sugar fields to `definePermissions` that compose with `params` and raw `policies`:
- `maxUses` → `usage-limit` policy (per-action counter, not session-wide)
- `validUntil` / `validAfter` (`Date | number`) → `time-frame` policy; one-sided forms default the other end
- `valueLimit` → `value-limit` policy; **type-gated to payable functions** + runtime throw
- `spendingLimit` → `spending-limits` policy; **type-gated to ERC-20-transfer-shaped functions** (`(address,uint256)` / `(address,address,uint256)`) + runtime throw to prevent silently-wrong calldata decoding

Add `arg-policy` to the `Policy` union — the expression-tree successor to `universal-action`. Accepts an `ArgPolicyExpression` AST with `rule` / `not` / `and` / `or` nodes; compiled internally to the bit-packed `uint256[]` node layout expected by `ArgPolicy` (`0x0000000000167edE64D8751daACDdC0312565a73`). Use when a session needs disjunction (e.g. allowlist of recipients); plain AND-of-rules is still simpler with `universal-action`.
