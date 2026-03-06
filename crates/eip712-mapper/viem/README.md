# eip712-mapper-viem

WASM adapter that serializes [`eip712-mapper-core`](../core/) output into [viem](https://viem.sh)'s `TypedDataDefinition` JSON format.

Compiles to a `.wasm` binary loaded by the TypeScript SDK at runtime.

## What it does

1. Receives intent JSON via WASM linear memory
2. Calls `eip712-mapper-core::dispatch::build()` to get typed Rust structs
3. Serializes those structs into viem's expected JSON format:
   - Addresses as lowercase `0x`-prefixed hex strings
   - Numeric values as decimal strings (TypeScript converts to `BigInt`)
   - EIP-712 type definitions as JSON arrays
   - `FixedBytes<N>` as `0x`-prefixed hex strings

## Source files

| File | Purpose |
|------|---------|
| `lib.rs` | WASM entry point — memory management (`alloc`/`dealloc`), JSON I/O, result buffer |
| `serialize.rs` | Core structs to viem JSON — `to_wasm_output()`, per-type serializers, EIP-712 type definitions |
| `types.rs` | Output types — `SerializedTypedData`, `TypedDataDomain`, `WasmOutput`, `WasmError` |
| `util.rs` | Formatting helpers — `addr_to_json`, `parse_bigint`, `fixed_bytes_to_hex` |

## Building

```sh
cd crates/eip712-mapper
make build
```

Output:
- `target/wasm32-unknown-unknown/release/eip712_mapper_viem.wasm` (prod, default)
- `target/wasm32-unknown-unknown/release/eip712_mapper_viem_dev.wasm` (dev feature)

## Future adapters

This crate is one possible adapter for `eip712-mapper-core`. The same core logic could be wrapped by other adapters:

- **`eip712-mapper-alloy`** — Return `alloy_sol_types::Eip712Domain` + native structs directly (no JSON overhead)
- **`eip712-mapper-ethers`** — Serialize for ethers-rs
- **`eip712-mapper-go`** — Serialize for go-ethereum types
