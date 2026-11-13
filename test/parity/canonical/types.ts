const LAYERS = [
  'quoteRequest',
  'typedData',
  'signatures',
  'submitRequest',
  'reads',
  'errors',
  'cost',
  'steps',
  'traffic',
] as const

type Layer = (typeof LAYERS)[number]

type CanonicalLayers = Record<Layer, unknown>

interface CanonicalQuoteRequest {
  destinationChainId: number | string
  tokenRequests: { token: string; amount?: string }[]
  account: Record<string, unknown>
  recipient?: Record<string, unknown>
  destinationExecutions: unknown[]
  destinationGasLimit?: string
  preClaimExecutions?: Record<string, unknown[]>
  accountAccessList?: unknown
  options: Record<string, unknown>
  // Fields only one API version knows, kept under their own names.
  [extra: string]: unknown
}

interface CanonicalSubmitRequest {
  quoteRef: '<quote>'
  signatures: {
    origin: unknown[]
    destination?: string
    targetExecution?: string
  }
  authorizations?: { sponsor?: unknown[]; recipient?: unknown[] }
  permits?: Record<string, Record<string, string>>
  [extra: string]: unknown
}

interface CanonicalCostToken {
  chainId: number | string
  token: string
  amount: string
}

interface CanonicalFee {
  usd: number
  sponsored?: boolean
}

interface CanonicalCost {
  inputs: CanonicalCostToken[]
  outputs: CanonicalCostToken[]
  fees: {
    totalUsd: number
    gas: CanonicalFee
    bridge: CanonicalFee
    swap: CanonicalFee
    app: CanonicalFee
    protocol: CanonicalFee
  }
  versionOnly: Record<string, unknown>
}

interface CanonicalWireError {
  status: number
  code?: string
}

// One per API version: projects that version's wire bodies into the shared
// canonical model, and builds the stub a captured submit returns.
interface VersionAdapter {
  quoteRequest(body: unknown): CanonicalQuoteRequest
  submitRequest(body: unknown): CanonicalSubmitRequest
  cost(responseBody: unknown, requestBody: unknown): CanonicalCost | undefined
  wireError(status: number, body: unknown): CanonicalWireError
  submitStub(body: unknown): { status: number; body: unknown }
  // The intent id a successful submit response carries.
  submittedIntentId(responseBody: unknown): string | undefined
}

export type {
  CanonicalCost,
  CanonicalCostToken,
  CanonicalFee,
  CanonicalLayers,
  CanonicalQuoteRequest,
  CanonicalSubmitRequest,
  CanonicalWireError,
  Layer,
  VersionAdapter,
}
export { LAYERS }
