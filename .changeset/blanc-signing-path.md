---
'@rhinestone/sdk': major
---

Sign intents from the orchestrator-provided EIP-712 typed data.

- `signIntent`, `getTargetExecutionSignature`, and the `signTransaction`
  / `getTransactionMessages` chain now consume the `signData` field on
  the `Quote` returned by `createQuote`.
- `PreparedTransactionData` carries the `Quote` (under `quote`) instead
  of the legacy `IntentRoute`.
- Single-chain-ops, Permit2, and compact typed-data assembly is gone —
  the SDK walks the orchestrator-emitted `TypedDataDefinition` and
  coerces `uint*` / `int*` decimal-string fields back to `bigint` before
  hashing.
- Validator-specific signature wrapping (ERC-1271 / emissary / smart
  sessions, K1 ERC-7739) is unchanged.
