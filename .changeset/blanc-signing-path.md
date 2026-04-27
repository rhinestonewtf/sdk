---
'@rhinestone/sdk': major
---

Sign intents from the orchestrator-provided EIP-712 typed data.

`signIntent`, `getTargetExecutionSignature`, and the `signTransaction` /
`getTransactionMessages` chain now consume the `signData` field on the
`Quote` returned by `createQuote`. `PreparedTransactionData` carries the
`Quote` (under `quote`) instead of the legacy `IntentRoute`.

The SDK no longer assembles single-chain-ops, Permit2, or compact typed
data locally — the orchestrator emits the full `TypedDataDefinition`
shape per origin / destination / optional targetExecution, and the SDK
walks that message tree against the declared types, coercing
`uint*`/`int*` decimal-string fields back to `bigint` before hashing.
Validator-specific signature wrapping (ERC-1271 / emissary / smart
sessions, K1 ERC-7739) is unchanged.
