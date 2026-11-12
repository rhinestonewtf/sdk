import { adapterFor } from './canonical/project'
import { currentContext, type HttpRecord, nextSeq } from './context'
import { routeRequest } from './routing'
import { parseJson } from './serialize'

type FetchFn = typeof globalThis.fetch

const INSTALLED = Symbol.for('rhinestone.parity.fetchRecorder')

function queryMap(url: URL): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of new Set(url.searchParams.keys())) {
    out[key] = url.searchParams.getAll(key).join(',')
  }
  return out
}

// Wraps fetch so orchestrator calls made inside a parity run are recorded.
// Credentials are reduced to presence flags; submits in capture mode are
// answered with a stub and never forwarded.
function createRecordingFetch(underlying: FetchFn): FetchFn {
  const recording = async (input: RequestInfo | URL, init?: RequestInit) => {
    const ctx = currentContext()
    if (!ctx) return underlying(input, init)
    // The SDK calls fetch(url, init) with a string body.
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (!ctx.origins.includes(url.origin)) return underlying(input, init)
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers)
    const apiVersionHeader = headers.get('x-api-version') ?? undefined

    const route = routeRequest(method, url.pathname, apiVersionHeader)
    const record: HttpRecord = {
      seq: nextSeq(ctx),
      step: ctx.step,
      method,
      path: url.pathname,
      query: queryMap(url),
      apiVersion: route.apiVersion,
      op: route.op,
      apiVersionHeader,
      sdkVersionHeader: headers.get('x-sdk-version') ?? undefined,
      authHeadersPresent: {
        'x-api-key': headers.has('x-api-key'),
        authorization: headers.has('authorization'),
        'x-intent-extension': headers.has('x-intent-extension'),
      },
      requestBody: parseJson(
        typeof init?.body === 'string' ? init.body : undefined,
      ),
      status: 0,
      responseHeaders: {},
      responseBody: undefined,
      captured: false,
      faulted: false,
    }
    ctx.records.http.push(record)

    let forwardInit = init
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
      response = await underlying(input, forwardInit)
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
