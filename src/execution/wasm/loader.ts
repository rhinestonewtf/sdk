/**
 * WASM EIP-712 mapper loader.
 *
 * Fetches, caches, and invokes the WASM module that builds EIP-712
 * typed data from an intentOp. The WASM URL comes from the orchestrator's
 * `X-EIP712-Implementation` response header — this allows the backend to
 * version the mapper independently of the SDK.
 *
 * Flow: intentOp (JSON) → WASM `get_typed_data` → SerializedTypedData (JSON)
 *       → `deserializeWasmOutput` → viem `TypedDataDefinition[]`
 */
import type { TypedDataDefinition } from 'viem'
import { deserializeWasmOutput } from './deserialize'
import { WasmExecutionError, WasmLoadError } from './errors'
import type { WasmInput, WasmOutput } from './types'

/** Thin wrapper around a compiled WASM instance exposing only the typed-data function. */
interface WasmMapperInstance {
  getTypedData: (inputJson: string) => string
}

// Singleton cache — only one WASM binary is active at a time.
// Re-fetched when the URL changes (i.e., backend deploys a new mapper version).
let cachedInstance: WasmMapperInstance | null = null
let cachedUrl: string | null = null
let loadingPromise: Promise<WasmMapperInstance> | null = null
let loadingUrl: string | null = null

/**
 * Compiles a WASM binary and wraps it in a `WasmMapperInstance`.
 * Handles memory management for passing JSON strings across the WASM boundary:
 *   1. Allocate input buffer in WASM memory (`alloc`)
 *   2. Copy UTF-8 encoded JSON into the buffer
 *   3. Call `get_typed_data(ptr, len)` — WASM writes result to its own buffer
 *   4. Read result via `get_result_ptr` / `get_result_len`
 *   5. Free input buffer (`dealloc`)
 */
async function instantiateWasm(
  wasmBytes: ArrayBuffer,
): Promise<WasmMapperInstance> {
  const module = await WebAssembly.compile(wasmBytes)
  const instance = await WebAssembly.instantiate(module)
  const exports = instance.exports as Record<string, unknown>

  const memory = exports.memory as WebAssembly.Memory
  const getTypedDataRaw = exports.get_typed_data as
    | ((ptr: number, len: number) => number)
    | undefined
  const alloc = exports.alloc as ((len: number) => number) | undefined
  const dealloc = exports.dealloc as
    | ((ptr: number, len: number) => void)
    | undefined
  const getResultPtr = exports.get_result_ptr as (() => number) | undefined
  const getResultLen = exports.get_result_len as (() => number) | undefined

  if (!getTypedDataRaw || !alloc || !getResultPtr || !getResultLen) {
    throw new WasmLoadError({
      context: {
        message:
          'WASM module missing required exports: get_typed_data, alloc, get_result_ptr, get_result_len',
      },
    })
  }

  return {
    getTypedData(inputJson: string): string {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const inputBytes = encoder.encode(inputJson)

      const inputPtr = alloc(inputBytes.length)
      const memoryView = new Uint8Array(memory.buffer)
      memoryView.set(inputBytes, inputPtr)

      getTypedDataRaw(inputPtr, inputBytes.length)

      if (dealloc) {
        dealloc(inputPtr, inputBytes.length)
      }

      const resultPtr = getResultPtr()
      const resultLen = getResultLen()
      const resultView = new Uint8Array(memory.buffer, resultPtr, resultLen)
      return decoder.decode(resultView)
    },
  }
}

/** Fetches the WASM binary from the given URL and instantiates it. */
async function loadInstance(wasmUrl: string): Promise<WasmMapperInstance> {
  const response = await fetch(wasmUrl)
  if (!response.ok) {
    throw new WasmLoadError({
      context: { status: response.status, url: wasmUrl },
    })
  }
  const wasmBytes = await response.arrayBuffer()
  const instance = await instantiateWasm(wasmBytes)

  cachedInstance = instance
  cachedUrl = wasmUrl

  return instance
}

/** Returns a cached WASM instance, or fetches + compiles a new one if the URL changed. */
async function getWasmInstance(wasmUrl: string): Promise<WasmMapperInstance> {
  if (cachedInstance && cachedUrl === wasmUrl) {
    return cachedInstance
  }

  if (loadingPromise && loadingUrl === wasmUrl) {
    return loadingPromise
  }

  loadingUrl = wasmUrl
  loadingPromise = loadInstance(wasmUrl).finally(() => {
    loadingPromise = null
    loadingUrl = null
  })

  return loadingPromise
}

/** Drops the cached WASM instance so the next call re-fetches. Called on WASM execution errors. */
function invalidateCache(): void {
  cachedInstance = null
  cachedUrl = null
  loadingPromise = null
  loadingUrl = null
}

/**
 * Main entry point: converts an intentOp into viem-compatible EIP-712 typed data.
 *
 * 1. Serializes `input` (intentOp + context) to JSON (BigInts → decimal strings)
 * 2. Passes JSON into WASM `get_typed_data`
 * 3. WASM dispatcher routes to compact / permit2 / single-chain builder
 *    based on `elements[].mandate.qualifier.settlementContext`
 * 4. Parses WASM JSON output and deserializes decimal strings back to BigInt
 * 5. Returns viem `TypedDataDefinition[]` ready for `signTypedData` / `hashTypedData`
 *
 * @param input - The intentOp and account context to build typed data for
 * @param wasmUrl - URL of the WASM binary (from orchestrator `X-EIP712-Implementation` header)
 */
async function getIntentMessagesFromWasm(
  input: WasmInput,
  wasmUrl: string,
): Promise<{
  origin: TypedDataDefinition[]
  destination: TypedDataDefinition
}> {
  const instance = await getWasmInstance(wasmUrl)
  const inputJson = JSON.stringify(input, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  )

  const resultJson = instance.getTypedData(inputJson)
  const result = JSON.parse(resultJson) as WasmOutput | { error: string }

  if ('error' in result) {
    invalidateCache()
    throw new WasmExecutionError((result as { error: string }).error)
  }

  return deserializeWasmOutput(result as WasmOutput)
}

/** Pre-fetches and caches the WASM binary so subsequent calls to `getIntentMessagesFromWasm` are instant. */
async function preloadWasm(wasmUrl: string): Promise<void> {
  await getWasmInstance(wasmUrl)
}

export { getIntentMessagesFromWasm, preloadWasm, invalidateCache }
