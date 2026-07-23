import { type ErrorEnvelope, parseErrorEnvelope } from './errors'

export type FetchPort = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export async function fetchOrchestratorJson(input: {
  readonly fetch: FetchPort
  readonly url: string
  readonly init?: RequestInit
}): Promise<unknown> {
  // Transport-level failures reject here and bubble up raw so `isConnectionError`
  // can classify them for retry; only HTTP responses become typed errors.
  const response = await input.fetch(input.url, input.init)
  const traceId = response.headers.get('x-trace-id') ?? undefined
  if (!response.ok) {
    let body: {
      code?: string
      message?: string
      traceId?: string
      details?: unknown
    }
    try {
      body = (await response.json()) as typeof body
    } catch {
      body = {
        code: 'INTERNAL_ERROR',
        message: `Orchestrator request failed with status ${response.status}`,
        traceId: '',
      }
    }
    const envelope = {
      code: body.code ?? 'INTERNAL_ERROR',
      message:
        body.message ??
        `Orchestrator request failed with status ${response.status}`,
      traceId: traceId ?? body.traceId ?? '',
      details: body.details,
    }
    const retryAfter = response.headers.get('retry-after') ?? undefined
    throw parseErrorEnvelope(
      envelope as ErrorEnvelope,
      response.status,
      retryAfter ?? undefined,
    )
  }
  const body = await response.json()
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return {
      ...(body as Record<string, unknown>),
      ...(traceId ? { traceId } : {}),
    }
  }
  return body
}
