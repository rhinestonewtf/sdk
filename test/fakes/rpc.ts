import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Hex } from 'viem'

type JsonRpcRequest = {
  readonly id: number | string | null
  readonly jsonrpc: '2.0'
  readonly method: string
  readonly params?: readonly unknown[]
}

export type FakeRpc = {
  readonly url: string
  readonly requests: readonly JsonRpcRequest[]
  close(): Promise<void>
}

export async function createFakeRpc(options: {
  readonly chainId: number
  readonly code?: Hex
  readonly transactionCount?: bigint
  readonly responses?: Readonly<Record<string, unknown>>
  readonly errors?: Readonly<
    Record<string, { readonly code: number; readonly message: string }>
  >
}): Promise<FakeRpc> {
  const requests: JsonRpcRequest[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as
        | JsonRpcRequest
        | JsonRpcRequest[]
      const batch = Array.isArray(body) ? body : [body]
      const results = batch.map((entry) => {
        requests.push(entry)
        return handleRequest(entry, options)
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(Array.isArray(body) ? results : results[0]))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

function handleRequest(
  request: JsonRpcRequest,
  options: {
    readonly chainId: number
    readonly code?: Hex
    readonly transactionCount?: bigint
    readonly responses?: Readonly<Record<string, unknown>>
    readonly errors?: Readonly<
      Record<string, { readonly code: number; readonly message: string }>
    >
  },
) {
  const configuredError = options.errors?.[request.method]
  if (configuredError) {
    return { jsonrpc: '2.0', id: request.id, error: configuredError }
  }
  if (Object.hasOwn(options.responses ?? {}, request.method)) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: options.responses?.[request.method],
    }
  }
  let result: unknown
  switch (request.method) {
    case 'eth_chainId':
      result = toQuantity(BigInt(options.chainId))
      break
    case 'eth_getCode':
      result = options.code ?? '0x'
      break
    case 'eth_getTransactionCount':
      result = toQuantity(options.transactionCount ?? 0n)
      break
    default:
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32601,
          message: `Unsupported fake RPC method ${request.method}`,
        },
      }
  }
  return { jsonrpc: '2.0', id: request.id, result }
}

function toQuantity(value: bigint): Hex {
  return `0x${value.toString(16)}`
}
