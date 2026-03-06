import { ExecutionError } from '../error'

class WasmLoadError extends ExecutionError {
  constructor(params?: {
    context?: any
    errorType?: string
    traceId?: string
  }) {
    super({
      message:
        'Failed to load the typed data WASM module. Check your network connection.',
      ...params,
    })
  }
}

class WasmExecutionError extends ExecutionError {
  constructor(
    wasmError: string,
    params?: { context?: any; errorType?: string; traceId?: string },
  ) {
    super({
      message: `WASM typed data mapper error: ${wasmError}`,
      ...params,
    })
  }
}

export { WasmLoadError, WasmExecutionError }
