import {
  createOrchestratorClientError,
  OrchestratorClientError,
} from './errors'

export type FetchPort = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export async function fetchOrchestratorJson(input: {
  readonly fetch: FetchPort
  readonly url: string
  readonly init?: RequestInit
}): Promise<unknown> {
  let response: Response
  try {
    response = await input.fetch(input.url, input.init)
  } catch (cause) {
    throw createOrchestratorClientError({
      message: 'Orchestrator request failed',
      status: 0,
      cause,
    })
  }
  const traceId = response.headers.get('x-trace-id') ?? undefined
  let body: unknown
  try {
    body = await response.json()
  } catch (cause) {
    if (!response.ok) {
      throw new OrchestratorClientError({
        message: `Orchestrator request failed with status ${response.status}`,
        status: response.status,
        traceId,
        retryAfter: response.headers.get('retry-after') ?? undefined,
        cause,
      })
    }
    throw createOrchestratorClientError({
      message: 'Orchestrator returned invalid JSON',
      status: response.status,
      traceId,
      cause,
    })
  }
  if (!response.ok) {
    const envelope = body as {
      readonly code?: string
      readonly message?: string
      readonly traceId?: string
      readonly details?: unknown
    }
    throw createOrchestratorClientError({
      message:
        envelope?.message ??
        `Orchestrator request failed with status ${response.status}`,
      status: response.status,
      code: envelope?.code,
      traceId: traceId ?? envelope?.traceId,
      retryAfter: response.headers.get('retry-after') ?? undefined,
      details: envelope?.details,
    })
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return {
      ...(body as Record<string, unknown>),
      ...(traceId ? { traceId } : {}),
    }
  }
  return body
}
