import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { vi } from 'vitest'

const WASM_URL = 'https://test.local/eip712_mapper.wasm'
const WASM_PATH = resolve(
  __dirname,
  '../../crates/eip712-mapper/target/wasm32-unknown-unknown/release/eip712_mapper_viem.wasm',
)

export function setupWasmFetchMock() {
  const originalFetch = globalThis.fetch
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === WASM_URL) {
        const wasmBinary = readFileSync(WASM_PATH)
        return new Response(new Uint8Array(wasmBinary), { status: 200 })
      }
      return originalFetch(input, init)
    }),
  )
}
