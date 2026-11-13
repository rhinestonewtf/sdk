// Reads orchestrator error responses of both API versions into the alps body
// shape the v1 classifier understands. Detection is by body shape, not by the
// requested version: blanc still answers some failures (e.g. malformed JSON)
// in the alps shape.

type OrchestratorOperation =
  | 'quote'
  | 'submit'
  | 'status'
  | 'portfolio'
  | 'splits'
  | 'appFees'

interface NormalizedError {
  body: any
  traceId?: string
  blanc: boolean
}

const CAIP2_EIP155 = /^eip155:(\d+)$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// `{ code, message, details? }`. The gateway's auth body (`{ code, message,
// traceId }`) also matches; without details it maps to itself.
function isBlancEnvelope(
  body: unknown,
): body is { code: string; message: string; details?: unknown } {
  return (
    isPlainObject(body) &&
    typeof body.code === 'string' &&
    typeof body.message === 'string' &&
    !('errors' in body) &&
    !('error' in body)
  )
}

// v1 exposes chain ids as numbers; blanc reports them as CAIP-2 strings.
function caipChainIdsToNumbers(value: unknown): unknown {
  if (typeof value === 'string') {
    const match = CAIP2_EIP155.exec(value)
    return match ? Number(match[1]) : value
  }
  if (Array.isArray(value)) return value.map(caipChainIdsToNumbers)
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        caipChainIdsToNumbers(entry),
      ]),
    )
  }
  return value
}

function toAlpsBody(envelope: {
  code: string
  message: string
  details?: unknown
}): unknown {
  const { code, message } = envelope
  const details = caipChainIdsToNumbers(envelope.details)
  if (code === 'INSUFFICIENT_LIQUIDITY' && isPlainObject(details)) {
    return {
      error: code,
      message,
      availableIntents: details.availableIntents ?? [],
      unfillable: details.unfillable ?? {},
    }
  }
  // Blanc's `details` is alps's `errors` list. The top-level message is left
  // out because alps had none, and the classifier would read it first and
  // drop the entry's context.
  if (Array.isArray(details) && details.length > 0) {
    return { errors: details }
  }
  if (isPlainObject(details)) {
    return { errors: [{ message, context: details }] }
  }
  return { code, message }
}

function normalizeErrorResponse(input: {
  body: unknown
  traceIdHeader: string | null | undefined
}): NormalizedError {
  const { body, traceIdHeader } = input
  const bodyTraceId =
    isPlainObject(body) && typeof body.traceId === 'string'
      ? body.traceId
      : undefined
  // Browsers can't read the header unless the server exposes it over CORS.
  const traceId = traceIdHeader || bodyTraceId || undefined
  if (!isBlancEnvelope(body)) {
    return { body, traceId, blanc: false }
  }
  return { body: toAlpsBody(body), traceId, blanc: true }
}

function firstIssue(normalized: NormalizedError): {
  message?: unknown
  context?: unknown
} {
  const { body } = normalized
  if (!isPlainObject(body)) return {}
  if (Array.isArray(body.errors) && isPlainObject(body.errors[0])) {
    return body.errors[0]
  }
  return { message: body.message }
}

// Blanc rejects an unknown destination chain in chain-id validation, while
// alps reported it as `Unsupported chain id`. Without this, integrators'
// `UnsupportedChainIdError` handling would stop matching on quotes. Alps
// reports unknown source chains as `Unsupported chain id(s)` too, so the
// class matches if this catches one of those.
function isUnknownChainOnQuote(
  normalized: NormalizedError,
  operation: OrchestratorOperation,
  status: number,
): boolean {
  if (!normalized.blanc || operation !== 'quote' || status !== 400) {
    return false
  }
  const { message } = firstIssue(normalized)
  return (
    typeof message === 'string' && message.startsWith('Invalid CAIP-2 chain id')
  )
}

export type { NormalizedError, OrchestratorOperation }
export {
  caipChainIdsToNumbers,
  firstIssue,
  isUnknownChainOnQuote,
  normalizeErrorResponse,
}
