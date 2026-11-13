import { AsyncLocalStorage } from 'node:async_hooks'
import type { Fault } from './faults'
import type { ApiVersion, Op } from './routing'
import type { Plain } from './serialize'

type StepKind =
  | 'prepare'
  | 'messages'
  | 'sign'
  | 'submit'
  | 'wait'
  | 'read'
  | 'other'

type SubmitMode = 'capture' | 'live'

interface HttpRecord {
  seq: number
  step: string | undefined
  method: string
  path: string
  query: Record<string, string>
  apiVersion: ApiVersion
  op: Op
  apiVersionHeader: string | undefined
  sdkVersionHeader: string | undefined
  authHeadersPresent: {
    'x-api-key': boolean
    authorization: boolean
    'x-intent-extension': boolean
  }
  requestBody: unknown
  status: number
  responseHeaders: { 'x-trace-id'?: string; 'retry-after'?: string }
  responseBody: unknown
  captured: boolean
  faulted: boolean
  error?: string
}

interface SignerRecord {
  seq: number
  step: string | undefined
  signer: string
  method: 'sign' | 'signMessage' | 'signTypedData' | 'signAuthorization'
  payload: Plain
  // The 32-byte hash the signature commits to.
  digest: string | undefined
  output: Plain
}

interface StepError {
  name: string
  ctor: string
  message: string
  errorType?: string
  statusCode?: number
  context?: Plain
  hasTraceId?: boolean
}

interface StepRecord {
  seq: number
  name: string
  kind: StepKind
  ok: boolean
  value?: Plain
  error?: StepError
  // Set when the error is a harness defect, which fails the run.
  harness?: true
}

// A value that differs between sides by construction (a fresh account or
// salt per build); projection replaces it with `<id:label>`.
interface IdentityRecord {
  label: string
  value: string
  // A fresh signer: its signatures differ per side too.
  signer?: true
}

interface RunRecords {
  http: HttpRecord[]
  signer: SignerRecord[]
  steps: StepRecord[]
  identities?: IdentityRecord[]
}

interface RunContext {
  // `warmup` runs settle fixture state and are never compared.
  role: 'baseline' | 'candidate' | 'warmup'
  step: string | undefined
  submitMode: SubmitMode
  fault: Fault | undefined
  origins: string[]
  seq: number
  records: RunRecords
}

const als = new AsyncLocalStorage<RunContext>()

function currentContext(): RunContext | undefined {
  return als.getStore()
}

function nextSeq(ctx: RunContext): number {
  ctx.seq += 1
  return ctx.seq
}

function createRunContext(
  init: Omit<RunContext, 'step' | 'seq' | 'records'>,
): RunContext {
  return {
    ...init,
    step: undefined,
    seq: 0,
    records: { http: [], signer: [], steps: [], identities: [] },
  }
}

export type {
  HttpRecord,
  IdentityRecord,
  RunContext,
  RunRecords,
  SignerRecord,
  StepError,
  StepKind,
  StepRecord,
  SubmitMode,
}
export { als, createRunContext, currentContext, nextSeq }
