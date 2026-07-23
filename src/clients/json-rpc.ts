export type JsonRpcFetchPort = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export class JsonRpcClientError extends Error {
  readonly method: string
  readonly code?: number
  readonly data?: unknown

  constructor(input: {
    readonly method: string
    readonly message: string
    readonly code?: number
    readonly data?: unknown
    readonly cause?: unknown
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    )
    this.name = 'JsonRpcClientError'
    this.method = input.method
    this.code = input.code
    this.data = input.data
  }
}

let nextRequestId = 1

export async function requestJsonRpc(input: {
  readonly fetch: JsonRpcFetchPort
  readonly url: string
  readonly method: string
  readonly params: readonly unknown[]
}): Promise<unknown> {
  let response: Response
  try {
    response = await input.fetch(input.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: nextRequestId++,
        method: input.method,
        params: input.params,
      }),
    })
  } catch (cause) {
    throw new JsonRpcClientError({
      method: input.method,
      message: `JSON-RPC request ${input.method} failed`,
      cause,
    })
  }
  let envelope: {
    readonly result?: unknown
    readonly error?: {
      readonly code?: number
      readonly message?: string
      readonly data?: unknown
    }
  }
  try {
    envelope = (await response.json()) as typeof envelope
  } catch (cause) {
    throw new JsonRpcClientError({
      method: input.method,
      message: `JSON-RPC request ${input.method} returned invalid JSON`,
      cause,
    })
  }
  if (!response.ok || envelope.error) {
    throw new JsonRpcClientError({
      method: input.method,
      message:
        envelope.error?.message ??
        `JSON-RPC request ${input.method} failed with status ${response.status}`,
      code: envelope.error?.code,
      data: envelope.error?.data,
    })
  }
  return envelope.result
}
