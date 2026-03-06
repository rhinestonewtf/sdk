/**
 * Converts WASM mapper output (JSON with string-encoded numbers) into
 * viem-compatible `TypedDataDefinition` objects with native BigInt values.
 *
 * The WASM mapper returns EIP-712 typed data with all numeric values as
 * decimal strings (since JSON has no bigint type). This module walks the
 * message tree and converts those strings back to BigInt so viem's
 * `signTypedData` / `hashTypedData` can consume them directly.
 */
import type { TypedDataDefinition } from 'viem'
import type { SerializedTypedData, WasmOutput } from './types'

const BIGINT_STRING_PATTERN = /^-?\d+$/

/**
 * Recursively converts decimal-string values to BigInt.
 * Strings matching `/^-?\d+$/` become BigInt; arrays and objects are traversed recursively.
 */
function deserializeValue(value: unknown): unknown {
  if (typeof value === 'string' && BIGINT_STRING_PATTERN.test(value)) {
    return BigInt(value)
  }
  if (Array.isArray(value)) {
    return value.map(deserializeValue)
  }
  if (value !== null && typeof value === 'object') {
    return deserializeObject(value as Record<string, unknown>)
  }
  return value
}

/** Applies `deserializeValue` to every value in a flat object. */
function deserializeObject(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[key] = deserializeValue(value)
  }
  return result
}

/**
 * Converts a single WASM `SerializedTypedData` into viem's `TypedDataDefinition`.
 * Domain and types are passed through as-is; the message is deserialized
 * to convert decimal strings → BigInt.
 */
function deserializeTypedData(
  serialized: SerializedTypedData,
): TypedDataDefinition {
  return {
    domain: serialized.domain,
    types: serialized.types,
    primaryType: serialized.primaryType,
    message: deserializeObject(serialized.message),
  } as unknown as TypedDataDefinition
}

/**
 * Converts the full WASM output into viem-ready typed data.
 * Returns `origin` (one per intent element, used for origin chain signatures)
 * and `destination` (the last origin entry, used for the destination chain signature).
 */
function deserializeWasmOutput(output: WasmOutput): {
  origin: TypedDataDefinition[]
  destination: TypedDataDefinition
} {
  const origin = output.origin.map(deserializeTypedData)
  const destination = origin.at(-1) as TypedDataDefinition
  return { origin, destination }
}

export { deserializeWasmOutput, deserializeTypedData, deserializeValue }
