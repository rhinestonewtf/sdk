import { adapterFor } from './canonical/project'
import { currentContext, type HttpRecord, nextSeq } from './context'
import { routeRequest } from './routing'
import { parseJson } from './serialize'

type FetchFn = typeof globalThis.fetch

const INSTALLED = Symbol.for('rhinestone.parity.fetchRecorder')

function headerMap(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value
    })
    return out
  }
  const entries = Array.isArray(headers) ? headers : Object.entries(headers)
  for (const [key, value] of entries) {
    if (value !== undefined) out[key.toLowerCase()] = String(value)
  }
  return out
}

function queryMap(url: URL): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of new Set(url.searchParams.keys())) {
    out[key] = url.searchParams.getAll(key).join(',')
  }
  return out
}

async function readRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<{
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
}> {
  if (input instanceof Request) {
    return {
      url: input.url,
      method: init?.method ?? input.method,
      headers: { ...headerMap(input.headers), ...headerMap(init?.headers) },
      body:
        typeof init?.body === 'string'
          ? init.body
          : input.body
            ? await input.clone().text()
            : undefined,
    }
  }
  return {
    url: input.toString(),
    method: init?.method ?? 'GET',
    headers: headerMap(init?.headers),
    body: typeof init?.body === 'string' ? init.body : undefined,
  }
}

// Wraps fetch so orchestrator calls made inside a parity run are recorded.
// Credentials are reduced to presence flags; submits in capture mode are
// answered with a stub and never forwarded.
function createRecordingFetch(underlying: FetchFn): FetchFn {
  const recording = async (input: RequestInfo | URL, init?: RequestInit) => {
    const ctx = currentContext()
    if (!ctx) return underlying(input, init)
    const request = await readRequest(input, init)
    const url = new URL(request.url)
    if (!ctx.origins.includes(url.origin)) return underlying(input, init)

    const route = routeRequest(
      request.method,
      url.pathname,
      request.headers['x-api-version'],
    )
    const record: HttpRecord = {
      seq: nextSeq(ctx),
      step: ctx.step,
      method: request.method.toUpperCase(),
      path: url.pathname,
      query: queryMap(url),
      apiVersion: route.apiVersion,
      op: route.op,
      apiVersionHeader: request.headers['x-api-version'],
      sdkVersionHeader: request.headers['x-sdk-version'],
      authHeadersPresent: {
        'x-api-key': 'x-api-key' in request.headers,
        authorization: 'authorization' in request.headers,
        'x-intent-extension': 'x-intent-extension' in request.headers,
      },
      requestBody: parseJson(request.body),
      status: 0,
      responseHeaders: {},
      responseBody: undefined,
      captured: false,
      faulted: false,
    }
    ctx.records.http.push(record)

    let forwardInit: RequestInit = init ?? {
      method: request.method,
      headers: request.headers,
      body: request.body,
    }
    if (ctx.fault && ctx.role === 'candidate' && ctx.fault.op === route.op) {
      const mutated = ctx.fault.transform(
        structuredClone(record.requestBody),
        route.apiVersion,
      )
      record.requestBody = mutated
      record.faulted = true
      forwardInit = { ...forwardInit, body: JSON.stringify(mutated) }
    }

    if (ctx.submitMode === 'capture' && route.op === 'submit') {
      const stub = adapterFor(route.apiVersion).submitStub(record.requestBody)
      record.captured = true
      record.status = stub.status
      record.responseBody = stub.body
      return new Response(JSON.stringify(stub.body), {
        status: stub.status,
        headers: { 'content-type': 'application/json' },
      })
    }

    let response: Response
    try {
      response = await underlying(
        input instanceof Request ? input.url : input,
        forwardInit,
      )
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error)
      throw error
    }
    record.status = response.status
    const traceId = response.headers.get('x-trace-id')
    const retryAfter = response.headers.get('retry-after')
    if (traceId) record.responseHeaders['x-trace-id'] = traceId
    if (retryAfter) record.responseHeaders['retry-after'] = retryAfter
    try {
      record.responseBody = parseJson(await response.clone().text())
    } catch {
      record.responseBody = undefined
    }
    return response
  }
  return recording as FetchFn
}

function installFetchRecorder(): void {
  const current = globalThis.fetch as FetchFn & { [INSTALLED]?: true }
  if (current[INSTALLED]) return
  const wrapped = createRecordingFetch(current) as FetchFn & {
    [INSTALLED]?: true
  }
  wrapped[INSTALLED] = true
  globalThis.fetch = wrapped
}

export { createRecordingFetch, installFetchRecorder }
