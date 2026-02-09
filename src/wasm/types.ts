export interface WasmConfig {
  enabled: boolean
  /** URL to fetch the WASM binary from. If not set, uses the default CDN URL. */
  url?: string
  /** Fetch timeout in milliseconds. Default: 5000. */
  timeout?: number
}

/** Interface matching the wasm-bindgen exports from the Rust crate. */
export interface WasmModule {
  version(): string
  get_ownable_validator(input: unknown): unknown
  get_ens_validator(input: unknown): unknown
  get_webauthn_validator(input: unknown): unknown
  get_multi_factor_validator(input: unknown): unknown
  get_compact_typed_data(input: unknown): unknown
  get_permit2_typed_data(input: unknown): unknown
  get_single_chain_typed_data_legacy(input: unknown): unknown
  get_single_chain_typed_data_with_gas_refund(input: unknown): unknown
}
