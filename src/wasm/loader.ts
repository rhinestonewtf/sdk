import type { WasmConfig, WasmModule } from './types'

const DEFAULT_WASM_URL =
  'https://cdn.rhinestone.dev/wasm/encoding/v0.1.0/rhinestone_encoding_wasm_bg.wasm'
const DEFAULT_TIMEOUT = 5000

let globalConfig: WasmConfig = { enabled: false }
let wasmInstance: WasmModule | null = null
let wasmPromise: Promise<WasmModule | null> | null = null

export function setWasmConfig(config: WasmConfig | boolean): void {
  if (typeof config === 'boolean') {
    globalConfig = { enabled: config }
  } else {
    globalConfig = config
  }
}

export function getWasmConfig(): WasmConfig {
  return globalConfig
}

/** Synchronous check: returns the cached WASM instance or null. */
export function getWasmInstance(): WasmModule | null {
  return wasmInstance
}

/** Returns true if WASM module is loaded and ready. */
export function isWasmLoaded(): boolean {
  return wasmInstance !== null
}

/**
 * Load and instantiate the WASM module.
 * Deduplicates concurrent calls. Returns null on failure (logs a warning).
 */
export async function loadWasm(
  config?: Partial<WasmConfig>,
): Promise<WasmModule | null> {
  // Return cached instance
  if (wasmInstance) return wasmInstance

  // Deduplicate concurrent loads
  if (wasmPromise) return wasmPromise

  const url = config?.url ?? globalConfig.url ?? DEFAULT_WASM_URL
  const timeout = config?.timeout ?? globalConfig.timeout ?? DEFAULT_TIMEOUT

  wasmPromise = doLoadWasm(url, timeout)
  const result = await wasmPromise
  wasmPromise = null
  return result
}

async function doLoadWasm(
  url: string,
  timeout: number,
): Promise<WasmModule | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)

    if (!response.ok) {
      console.warn(
        `[rhinestone/wasm] Failed to fetch WASM: ${response.status} ${response.statusText}`,
      )
      return null
    }

    const wasmBytes = await response.arrayBuffer()

    // Use the wasm-bindgen generated JS glue to instantiate.
    // The glue handles memory management and the wasm-bindgen protocol.
    const mod = await loadWasmWithGlue(wasmBytes)
    if (mod) {
      wasmInstance = mod
      return mod
    }

    return null
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.warn('[rhinestone/wasm] WASM fetch timed out')
    } else {
      console.warn('[rhinestone/wasm] Failed to load WASM:', err)
    }
    return null
  }
}

/**
 * Load WASM using the wasm-bindgen generated JS glue.
 * This is the primary loading path — the glue handles memory management
 * and the wasm-bindgen protocol.
 */
async function loadWasmWithGlue(
  wasmBytes: ArrayBuffer,
): Promise<WasmModule | null> {
  try {
    // Dynamic import of the wasm-pack generated glue module.
    // In production, this glue JS is bundled with the SDK.
    // The WASM binary itself is fetched from the remote URL.
    const glue = await import(
      /* webpackIgnore: true */
      '../../crates/encoding-wasm/pkg/rhinestone_encoding_wasm.js'
    )

    // The default export is the init function — pass the raw bytes
    await glue.default(wasmBytes)

    // After init, the named exports are available
    return {
      version: glue.version,
      get_ownable_validator: glue.get_ownable_validator,
      get_ens_validator: glue.get_ens_validator,
      get_webauthn_validator: glue.get_webauthn_validator,
      get_multi_factor_validator: glue.get_multi_factor_validator,
      get_compact_typed_data: glue.get_compact_typed_data,
      get_permit2_typed_data: glue.get_permit2_typed_data,
      get_single_chain_typed_data_legacy:
        glue.get_single_chain_typed_data_legacy,
      get_single_chain_typed_data_with_gas_refund:
        glue.get_single_chain_typed_data_with_gas_refund,
    }
  } catch (err) {
    console.warn('[rhinestone/wasm] Failed to load WASM glue:', err)
    return null
  }
}

/**
 * Eagerly load and cache the WASM module.
 * Call this at SDK initialization if you want WASM ready before the first encoding call.
 * Returns true if WASM loaded successfully.
 */
export async function preloadWasm(
  config?: Partial<WasmConfig>,
): Promise<boolean> {
  const result = await loadWasm(config)
  return result !== null
}
