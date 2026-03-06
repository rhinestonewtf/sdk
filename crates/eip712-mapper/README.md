# eip712-mapper

Rust workspace that maps Rhinestone intent operations into EIP-712 typed data structures for signing.

## Crates

| Crate | Purpose |
|-------|---------|
| [`eip712-mapper-core`](./core/) | Pure business logic — typed Rust structs, no JSON or format-specific encoding |
| [`eip712-mapper-viem`](./viem/) | WASM adapter — serializes core output into [viem](https://viem.sh)'s `TypedDataDefinition` JSON format |

## What this does (and what it does not)

This workspace is a **data mapper**, not a signing or hashing implementation. It takes a Rhinestone `intentOp` (the orchestrator's response describing a cross-chain intent) and produces the EIP-712 `domain`, `types`, `primaryType`, and `message` fields needed for signing.

**This module does NOT:**
- Compute the EIP-712 struct hash or domain separator
- Calculate the final digest (`\x19\x01 ‖ domainSeparator ‖ structHash`)
- Sign anything

All cryptographic operations are performed by **viem** in the TypeScript layer. This means the user's wallet always receives a standard EIP-712 `signTypedData` call with full type legibility.

## Architecture

```
Orchestrator API
    │
    ▼
intentOp (JSON) ──► WASM get_typed_data() ──► EIP-712 typed data (JSON)
                         │                              │
                    ┌────┴────┐                   deserialize.ts
                    │  core   │                   (string → BigInt)
                    │ dispatch│                         │
                    │ + build │                         ▼
                    └────┬────┘               viem TypedDataDefinition
                         │                            │
                    ┌────┴────┐                       ▼
                    │  viem   │              viem signTypedData()
                    │serialize│              viem hashTypedData()
                    └─────────┘
```

**Core** routes by `settlementContext` and returns typed Rust structs (`alloy_primitives`).
**Viem** serializes those structs into JSON (decimal strings, hex addresses, EIP-712 type definitions).

### Settlement type dispatch

| Condition | Builder | EIP-712 primaryType | Domain |
|-----------|---------|-------------------|--------|
| `settlementLayer == "INTENT_EXECUTOR"` | `single_chain.rs` | `SingleChainOps` | IntentExecutor |
| `fundingMethod == "PERMIT2"` | `permit2.rs` | `PermitBatchWitnessTransferFrom` | Permit2 |
| Default (compact) | `compact.rs` | `MultichainCompact` | The Compact |

## WASM interface

The compiled `.wasm` binary exports four functions:

| Export | Signature | Purpose |
|--------|-----------|---------|
| `alloc` | `(len: u32) → ptr: u32` | Allocate buffer in WASM linear memory |
| `dealloc` | `(ptr: u32, len: u32)` | Free buffer |
| `get_typed_data` | `(ptr: u32, len: u32) → status: i32` | Process input JSON, write result to internal buffer. Returns 0 on success, 1 on error. |
| `get_result_ptr` / `get_result_len` | `() → u32` | Read the result buffer location and size |

## Building

```sh
make build
```

Requires `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`). Optionally uses `wasm-opt` for size optimization.

Output:
- `target/wasm32-unknown-unknown/release/eip712_mapper_viem.wasm` (prod, default)
- `target/wasm32-unknown-unknown/release/eip712_mapper_viem_prod.wasm`
- `target/wasm32-unknown-unknown/release/eip712_mapper_viem_dev.wasm`

## Testing

```sh
make test
```

Tests run natively (not in WASM). Both crates have unit tests. The TypeScript integration tests (`src/execution/wasm/loader.test.ts`) load the compiled `.wasm` binary and verify end-to-end output for all three settlement types.
