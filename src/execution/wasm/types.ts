import type { Address } from 'viem'
import type { IntentOp } from '../../orchestrator/types'

/**
 * Input passed to the WASM EIP-712 mapper.
 * Serialized to JSON and written into WASM linear memory.
 *
 * The WASM module's `dispatch.rs` inspects `intentOp.elements[].mandate.qualifier.settlementContext`
 * to route to the correct EIP-712 builder (compact, permit2, or single-chain).
 *
 * Contract addresses (Compact, Permit2, IntentExecutor) are hardcoded in the WASM
 * at compile time. The orchestrator serves the appropriate WASM binary (prod vs dev).
 */
interface WasmInput {
  intentOp: IntentOp
  context: {
    accountAddress: Address
  }
}

/** A single field in an EIP-712 type definition (e.g. `{ name: "amount", type: "uint256" }`) */
interface SerializedTypedDataField {
  name: string
  type: string
}

/**
 * EIP-712 typed data as returned by the WASM mapper.
 * This is the JSON-serialized form — numeric values are decimal strings,
 * not yet converted to BigInt. Use `deserializeTypedData` to convert
 * to viem's `TypedDataDefinition`.
 */
interface SerializedTypedData {
  domain: {
    name: string
    version?: string
    chainId: number
    verifyingContract: Address
  }
  types: Record<string, SerializedTypedDataField[]>
  primaryType: string
  message: Record<string, unknown>
}

/**
 * Raw output from the WASM mapper's `get_typed_data` export.
 * Contains one EIP-712 typed data per intent element (origin signatures).
 * The last origin entry doubles as the destination signature data.
 */
interface WasmOutput {
  origin: SerializedTypedData[]
}

export type {
  WasmInput,
  WasmOutput,
  SerializedTypedData,
  SerializedTypedDataField,
}
