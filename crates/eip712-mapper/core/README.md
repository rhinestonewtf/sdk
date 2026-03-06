# eip712-mapper-core

Pure business logic for mapping Rhinestone intent operations into EIP-712 typed data structures. Returns typed Rust structs — no JSON serialization, no format-specific encoding.

This crate is the foundation for format-specific adapters like [`eip712-mapper-viem`](../viem/).

## What it does

Takes an orchestrator `intentOp` and produces typed Rust structs representing the EIP-712 domain, message fields, and commitments for each settlement type:

- **`CompactTypedData`** — MultichainCompact (The Compact protocol)
- **`Permit2TypedData`** — PermitBatchWitnessTransferFrom (Uniswap Permit2)
- **`SingleChainTypedData`** — SingleChainOps (IntentExecutor)

All output uses native `alloy_primitives` types (`Address`, `U256`, `FixedBytes<N>`) — no hex strings or decimal string encoding.

## Key types

```rust
// Dispatch returns one of three settlement types
enum TypedDataResult {
    Compact(CompactTypedData),
    Permit2(Vec<Permit2TypedData>),
    SingleChain(Vec<SingleChainTypedData>),
}

// Domain separator with typed fields
struct Eip712Domain {
    name: &'static str,
    version: Option<&'static str>,
    chain_id: u64,
    verifying_contract: Address,
}

// Token lock in Compact: raw bytes, not hex strings
struct CompactLock {
    lock_tag: FixedBytes<12>,
    token: Address,
    amount: U256,
}
```

## Entry point

```rust
use eip712_mapper_core::dispatch;
use eip712_mapper_core::input::WasmInput;

let input: WasmInput = serde_json::from_str(json)?;
let result = dispatch::build(&input)?;
```

## Source files

| File | Purpose |
|------|---------|
| `input.rs` | Input types (`WasmInput`, `IntentOp`, etc.) deserialized from orchestrator JSON |
| `types.rs` | Output types — typed Rust structs for each settlement type |
| `dispatch.rs` | Routes to correct builder based on `settlementContext` |
| `compact.rs` | Builds `CompactTypedData` (token ID splitting, lock commitments) |
| `permit2.rs` | Builds `Permit2TypedData` (160-bit bitmask token extraction) |
| `single_chain.rs` | Builds `SingleChainTypedData` (gas refund handling) |
| `util.rs` | Helpers — `split_token_id`, `to_token`, `keccak256_bytes` |
| `serde_helpers.rs` | Decimal string to U256 deserializers for input parsing |
